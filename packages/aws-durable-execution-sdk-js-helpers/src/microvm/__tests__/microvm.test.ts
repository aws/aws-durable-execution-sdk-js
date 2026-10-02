import { createHash } from "node:crypto";
import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import {
  AccessDeniedException,
  ResourceNotFoundException,
  ThrottlingException,
  ValidationException,
} from "@aws-sdk/client-lambda-microvms";
import {
  DEFAULT_MICROVM_JOB_PATH,
  defaultMicrovmRetryStrategy,
  durationToSeconds,
  MAX_RUN_HOOK_PAYLOAD_LENGTH,
  type MicrovmConfig,
  microvm,
} from "..";
import {
  baseConfig,
  FakeEndpoint,
  FakeMicrovmsClient,
  metadata,
  throwing,
} from "./fakes";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("microvm", () => {
  it("launches one MicroVM, returns the callback result, and terminates the MicroVM", async () => {
    const client = new FakeMicrovmsClient();
    const handler = withDurableExecution(
      async (event: { repo: string }, context: DurableContext) =>
        microvm(context, "build", event, {
          ...baseConfig(client),
          heartbeatTimeout: { seconds: 30 },
        }),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const executionPromise = runner.run({ payload: { repo: "org/app" } });
    const callback = runner.getOperation("build.callback");
    await callback.waitForData(WaitingOperationStatus.STARTED);
    await runner
      .getOperation("build.launch")
      .waitForData(WaitingOperationStatus.COMPLETED);
    await callback.sendCallbackSuccess(JSON.stringify({ passed: true }));
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({ passed: true });

    // The handler replays after the callback completes. The launch step
    // returns its checkpointed result on replay, so RunMicrovm runs once.
    expect(client.runInputs).toHaveLength(1);
    const payload = client.payload();
    expect(payload).toEqual({
      version: 1,
      region: expect.any(String),
      job: {
        callbackId: expect.any(String),
        heartbeatTimeoutSeconds: 30,
        input: { repo: "org/app" },
      },
    });
    const callbackId = payload.job?.callbackId as string;

    const run = client.runInputs[0];
    const { region } = payload;
    // The local runner's execution ARN is not an ARN, so the Region falls
    // back to AWS_REGION.
    expect(region).toBe(process.env.AWS_REGION ?? "");
    expect(run).toEqual({
      imageIdentifier: "arn:aws:lambda:us-east-1:123456789012:microvm-image:ci",
      imageVersion: undefined,
      executionRoleArn: "arn:aws:iam::123456789012:role/microvm-role",
      clientToken: createHash("sha256").update(callbackId).digest("hex"),
      ingressNetworkConnectors: [
        `arn:aws:lambda:${region}:aws:network-connector:aws-network-connector:NO_INGRESS`,
      ],
      egressNetworkConnectors: [
        `arn:aws:lambda:${region}:aws:network-connector:aws-network-connector:INTERNET_EGRESS`,
      ],
      maximumDurationInSeconds: 30 * 60 + 300,
      logging: undefined,
      runHookPayload: expect.any(String),
    });
    expect(run).not.toHaveProperty("idlePolicy");
    expect((run.clientToken as string).length).toBeLessThanOrEqual(128);

    expect(client.terminateInputs).toEqual([{ microvmIdentifier: "mvm-1" }]);
  });

  it("runs in a child context when the caller passes the child's context", async () => {
    const client = new FakeMicrovmsClient();
    const handler = withDurableExecution(
      async (event: { repo: string }, context: DurableContext) =>
        context.runInChildContext("pipeline", (pipeline) =>
          microvm<{ passed: boolean }>(
            pipeline,
            "build",
            event,
            baseConfig(client),
          ),
        ),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const executionPromise = runner.run({ payload: { repo: "org/app" } });
    const callback = runner.getOperation("build.callback");
    await callback.waitForData(WaitingOperationStatus.STARTED);
    await callback.sendCallbackSuccess(JSON.stringify({ passed: true }));
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({ passed: true });
    expect(client.runInputs).toHaveLength(1);
    expect(client.terminateInputs).toHaveLength(1);
    // The operation's own context belongs to the caller's child context, and
    // its steps belong to the operation's context.
    const pipelineId = runner.getOperation("pipeline").getId();
    const build = runner.getOperation("build");
    expect(build.getParentId()).toBe(pipelineId);
    expect(runner.getOperation("build.launch").getParentId()).toBe(
      build.getId(),
    );
  });

  it("runs one MicroVM per map item when each item passes its own context", async () => {
    const client = new FakeMicrovmsClient();
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        const batch = await context.map("builds", ["a", "b"], (itemCtx, repo) =>
          microvm<string>(
            itemCtx,
            `build-${repo}`,
            { repo },
            baseConfig(client),
          ),
        );
        batch.throwIfError();
        return batch.getResults();
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const executionPromise = runner.run({ payload: {} });
    for (const repo of ["a", "b"]) {
      const callback = runner.getOperation(`build-${repo}.callback`);
      await callback.waitForData(WaitingOperationStatus.STARTED);
      await callback.sendCallbackSuccess(JSON.stringify(`built ${repo}`));
    }
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual(["built a", "built b"]);
    // Each item launched its own MicroVM, with its own client token.
    expect(client.runInputs).toHaveLength(2);
    expect(new Set(client.runInputs.map((i) => i.clientToken)).size).toBe(2);
    // Each operation's context is a child of a different map item.
    const parents = ["a", "b"].map((repo) =>
      runner.getOperation(`build-${repo}`).getParentId(),
    );
    expect(parents[0]).toBeDefined();
    expect(parents[0]).not.toBe(parents[1]);
  });

  it("fails with the MicroVM's error and still terminates the MicroVM", async () => {
    const client = new FakeMicrovmsClient();
    const handler = withDurableExecution(
      async (event: { repo: string }, context: DurableContext) =>
        microvm(context, "build", event, baseConfig(client)),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const executionPromise = runner.run({ payload: { repo: "org/app" } });
    const callback = runner.getOperation("build.callback");
    await callback.waitForData(WaitingOperationStatus.STARTED);
    await callback.sendCallbackFailure({
      ErrorType: "BuildFailed",
      ErrorMessage: "3 tests failed",
    });
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()?.errorMessage).toContain("3 tests failed");
    expect(client.terminateInputs).toEqual([{ microvmIdentifier: "mvm-1" }]);
  });

  it("returns the result when terminate fails, because the result is already recorded", async () => {
    const client = new FakeMicrovmsClient();
    client.terminateResponses = [
      throwing(new AccessDeniedException({ message: "denied", ...metadata })),
    ];
    const handler = withDurableExecution(
      async (event: { repo: string }, context: DurableContext) =>
        microvm(context, "build", event, baseConfig(client)),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const executionPromise = runner.run({ payload: { repo: "org/app" } });
    const callback = runner.getOperation("build.callback");
    await callback.waitForData(WaitingOperationStatus.STARTED);
    await callback.sendCallbackSuccess(JSON.stringify("ok"));
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toBe("ok");
    // AccessDeniedException is not retryable, so terminate runs once.
    expect(client.terminateInputs).toHaveLength(1);
  });

  it("treats ResourceNotFoundException from terminate as a terminated MicroVM", async () => {
    const client = new FakeMicrovmsClient();
    client.terminateResponses = [
      throwing(new ResourceNotFoundException({ message: "gone", ...metadata })),
    ];
    const handler = withDurableExecution(
      async (event: { repo: string }, context: DurableContext) =>
        microvm(context, "build", event, baseConfig(client)),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const executionPromise = runner.run({ payload: { repo: "org/app" } });
    const callback = runner.getOperation("build.callback");
    await callback.waitForData(WaitingOperationStatus.STARTED);
    await callback.sendCallbackSuccess(JSON.stringify("ok"));
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.terminateInputs).toHaveLength(1);
    expect(
      runner.getOperation("build.terminate").getStepDetails()?.error,
    ).toBeUndefined();
  });

  it("retries a throttled launch with the same client token", async () => {
    const client = new FakeMicrovmsClient();
    client.runResponses = [
      throwing(new ThrottlingException({ message: "slow down", ...metadata })),
    ];
    const handler = withDurableExecution(
      async (event: { repo: string }, context: DurableContext) =>
        microvm(context, "build", event, baseConfig(client)),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const executionPromise = runner.run({ payload: { repo: "org/app" } });
    const callback = runner.getOperation("build.callback");
    await runner
      .getOperation("build.launch")
      .waitForData(WaitingOperationStatus.COMPLETED);
    await callback.sendCallbackSuccess(JSON.stringify("ok"));
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.runInputs).toHaveLength(2);
    expect(client.runInputs[1].clientToken).toBe(
      client.runInputs[0].clientToken,
    );
  });

  it("fails with the launch error and skips terminate when RunMicrovm rejects the request", async () => {
    const client = new FakeMicrovmsClient();
    client.runResponses = [
      throwing(new ValidationException({ message: "bad image", ...metadata })),
    ];
    const handler = withDurableExecution(
      async (event: { repo: string }, context: DurableContext) =>
        microvm(context, "build", event, baseConfig(client)),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const execution = await runner.run({ payload: { repo: "org/app" } });

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()?.errorMessage).toContain("bad image");
    expect(client.runInputs).toHaveLength(1);
    expect(client.terminateInputs).toHaveLength(0);
  });

  it("rejects a timeout above 8 hours before any durable operation", async () => {
    const client = new FakeMicrovmsClient();
    const handler = withDurableExecution(
      async (event: { repo: string }, context: DurableContext) =>
        microvm(context, "build", event, {
          ...baseConfig(client),
          timeout: { hours: 9 },
        }),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const execution = await runner.run({ payload: { repo: "org/app" } });

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()?.errorMessage).toContain(
      "timeout must be between 1 second and 28800 seconds",
    );
    expect(execution.getOperations()).toHaveLength(0);
    expect(client.runInputs).toHaveLength(0);
  });

  it("sends a job too large for the run hook over HTTP to the default job path", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const input = { blob: "x".repeat(5_000) };
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) =>
        microvm(context, "build", input, {
          ...baseConfig(client),
          fetch: endpoint.fetch,
        }),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const executionPromise = runner.run({ payload: {} });
    const callback = runner.getOperation("build.callback");
    await callback.waitForData(WaitingOperationStatus.STARTED);
    await runner
      .getOperation("build.request")
      .waitForData(WaitingOperationStatus.COMPLETED);
    await callback.sendCallbackSuccess(JSON.stringify({ passed: true }));
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    const region = process.env.AWS_REGION ?? "";
    // The run hook payload carries no job, and the MicroVM gets ingress.
    expect(client.payload()).toEqual({ version: 1, region });
    expect(client.runInputs[0].ingressNetworkConnectors).toEqual([
      `arn:aws:lambda:${region}:aws:network-connector:aws-network-connector:ALL_INGRESS`,
    ]);
    expect(endpoint.requests).toHaveLength(1);
    expect(endpoint.requests[0].url).toBe(
      `https://mvm-1.lambda-microvm.us-east-1.on.aws${DEFAULT_MICROVM_JOB_PATH}`,
    );
    expect(endpoint.requests[0].body.input).toEqual(input);
  });

  it("keeps the run hook for the largest job that fits, and switches to HTTP one character later", async () => {
    // The payload length depends on the callback ID. So the test measures
    // the payload of an empty-string input first, then pads the input.
    const launchWith = async (paddingLength: number) => {
      const client = new FakeMicrovmsClient();
      const endpoint = new FakeEndpoint();
      const handler = withDurableExecution(
        async (event: { padding: number }, context: DurableContext) =>
          microvm(context, "build", "x".repeat(event.padding), {
            ...baseConfig(client),
            fetch: endpoint.fetch,
          }),
      );
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });
      const execution = runner.run({ payload: { padding: paddingLength } });
      await runner
        .getOperation("build.launch")
        .waitForData(WaitingOperationStatus.COMPLETED);
      await runner
        .getOperation("build.callback")
        .sendCallbackSuccess(JSON.stringify("done"));
      expect((await execution).getStatus()).toBe("SUCCEEDED");
      return client.runInputs[0].runHookPayload as string;
    };

    const base = (await launchWith(0)).length;
    const fits = await launchWith(MAX_RUN_HOOK_PAYLOAD_LENGTH - base);
    const tooLarge = await launchWith(MAX_RUN_HOOK_PAYLOAD_LENGTH - base + 1);

    expect(fits).toHaveLength(MAX_RUN_HOOK_PAYLOAD_LENGTH);
    expect(JSON.parse(fits).job).toBeDefined();
    expect(JSON.parse(tooLarge).job).toBeUndefined();
  });

  it.each<[string, Partial<MicrovmConfig>, string]>([
    ["imageIdentifier", { imageIdentifier: "" }, "imageIdentifier is required"],
    [
      "executionRoleArn",
      { executionRoleArn: "" },
      "executionRoleArn is required",
    ],
  ])("rejects an empty %s", async (_field, overrides, message) => {
    const client = new FakeMicrovmsClient();
    const handler = withDurableExecution(
      async (event: unknown, context: DurableContext) =>
        microvm(context, "build", event, baseConfig(client, overrides)),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()?.errorMessage).toContain(message);
  });
});

describe("defaultMicrovmRetryStrategy", () => {
  it.each([
    "ThrottlingException",
    "InternalServerException",
    "ServiceUnavailableException",
    "ConflictException",
    "TimeoutError",
  ])("retries %s", (name) => {
    const error = Object.assign(new Error("x"), { name });
    expect(defaultMicrovmRetryStrategy(error, 1)).toEqual({
      shouldRetry: true,
      delay: { seconds: 2 },
    });
  });

  it.each([
    "ValidationException",
    "AccessDeniedException",
    "ResourceNotFoundException",
    "ServiceQuotaExceededException",
    "Error",
  ])("does not retry %s", (name) => {
    const error = Object.assign(new Error("x"), { name });
    expect(defaultMicrovmRetryStrategy(error, 1).shouldRetry).toBe(false);
  });

  it("retries an error that the AWS SDK marks as retryable", () => {
    const error = Object.assign(new Error("x"), { $retryable: {} });
    expect(defaultMicrovmRetryStrategy(error, 1).shouldRetry).toBe(true);
  });

  it("stops after 5 attempts and caps the delay at 60 seconds", () => {
    const error = Object.assign(new Error("x"), {
      name: "ThrottlingException",
    });
    expect(defaultMicrovmRetryStrategy(error, 4)).toEqual({
      shouldRetry: true,
      delay: { seconds: 16 },
    });
    expect(defaultMicrovmRetryStrategy(error, 5).shouldRetry).toBe(false);
    expect(defaultMicrovmRetryStrategy(error, 7).delay).toEqual({
      seconds: 60,
    });
  });
});

describe("durationToSeconds", () => {
  it("adds every unit and rounds up", () => {
    expect(
      durationToSeconds({ days: 1, hours: 1, minutes: 1, seconds: 1.5 }),
    ).toBe(86_400 + 3_600 + 60 + 2);
  });

  it("returns NaN for a missing duration", () => {
    expect(durationToSeconds(undefined)).toBeNaN();
  });
});

describe("microvm with request delivery", () => {
  const run = async (
    client: FakeMicrovmsClient,
    endpoint: FakeEndpoint,
    request: MicrovmConfig["request"],
    input: unknown = { repo: "org/app" },
    // null skips the callback completion, for runs that fail first.
    complete: string | null = JSON.stringify({ passed: true }),
  ) => {
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) =>
        microvm(context, "build", input, {
          ...baseConfig(client),
          heartbeatTimeout: { seconds: 30 },
          request,
          fetch: endpoint.fetch,
        }),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const executionPromise = runner.run({ payload: {} });
    if (complete !== null) {
      const callback = runner.getOperation("build.callback");
      await callback.waitForData(WaitingOperationStatus.STARTED);
      await runner
        .getOperation("build.request")
        .waitForData(WaitingOperationStatus.COMPLETED);
      await callback.sendCallbackSuccess(complete);
    }
    return { runner, execution: await executionPromise };
  };

  it("launches with ingress, POSTs the job to the route, and returns the callback result", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();

    const { execution } = await run(client, endpoint, { path: "/clone-build" });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({ passed: true });

    const launch = client.runInputs[0];
    const region = process.env.AWS_REGION ?? "";
    expect(launch.ingressNetworkConnectors).toEqual([
      `arn:aws:lambda:${region}:aws:network-connector:aws-network-connector:ALL_INGRESS`,
    ]);
    // The job goes over HTTP, so the run hook payload has no job.
    expect(client.payload()).toEqual({ version: 1, region });

    expect(client.tokenInputs).toEqual([
      {
        microvmIdentifier: "mvm-1",
        expirationInMinutes: 5,
        allowedPorts: [{ port: 8080 }],
      },
    ]);
    expect(endpoint.requests).toHaveLength(1);
    const [request] = endpoint.requests;
    expect(request.url).toBe(
      "https://mvm-1.lambda-microvm.us-east-1.on.aws/clone-build",
    );
    expect(request.headers).toEqual({
      "content-type": "application/json",
      "X-aws-proxy-auth": "token-1",
    });
    expect(request.body).toEqual({
      version: 1,
      region,
      microvmId: "mvm-1",
      callbackId: expect.any(String),
      heartbeatTimeoutSeconds: 30,
      input: { repo: "org/app" },
    });
    expect(launch.clientToken).toBe(
      createHash("sha256").update(request.body.callbackId).digest("hex"),
    );
    // Replays after the callback do not deliver the job again.
    expect(client.runInputs).toHaveLength(1);
    expect(client.terminateInputs).toEqual([{ microvmIdentifier: "mvm-1" }]);
  });

  it("retries connection errors and 5xx inside one step attempt", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    endpoint.responses = [new TypeError("fetch failed"), 503, 502, 202];

    const { execution } = await run(client, endpoint, { path: "/job" });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(endpoint.requests).toHaveLength(4);
    // Every step attempt creates one auth token. One token means the first
    // tier handled every failure, and the step did not retry.
    expect(client.tokenInputs).toHaveLength(1);
  });

  it("creates a new auth token after a 401 and retries", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    endpoint.responses = [401, 202];

    const { execution } = await run(client, endpoint, { path: "/job" });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(endpoint.requests.map((r) => r.headers["X-aws-proxy-auth"])).toEqual(
      ["token-1", "token-2"],
    );
  });

  it("hands a second 401 to the step retry, which starts with a new token", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    endpoint.responses = [401, 403, 202];

    const { execution } = await run(client, endpoint, { path: "/job" });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(endpoint.requests).toHaveLength(3);
    // Attempt 1 created two tokens. The step retry created the third.
    expect(client.tokenInputs).toHaveLength(3);
  });

  it("hands an exhausted first tier to the step retry", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    // The window is 1 second. Delays of 250, 500, and 1000 ms end the first
    // tier after 3 requests. The step retry then succeeds.
    endpoint.responses = [503, 503, 503];

    const { execution } = await run(client, endpoint, {
      path: "/job",
      retryWindow: { seconds: 1 },
    });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(endpoint.requests).toHaveLength(4);
    expect(client.tokenInputs).toHaveLength(2);
  });

  it("fails without a retry when the route rejects the job with a 4xx", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    endpoint.responses = [404];

    const { execution } = await run(
      client,
      endpoint,
      { path: "/missing" },
      { repo: "org/app" },
      null,
    );

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()?.errorMessage).toContain(
      "rejected the job at /missing with HTTP 404",
    );
    expect(endpoint.requests).toHaveLength(1);
    expect(client.terminateInputs).toEqual([{ microvmIdentifier: "mvm-1" }]);
  });

  // A full suite run on a loaded machine once took longer than the 5-second
  // default for this test, while it takes about 400 ms alone. So it gets a
  // longer limit. The test itself waits on no timer.
  it("sends a non-default port in the proxy header and scopes the token to it", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();

    await run(client, endpoint, { path: "/job", port: 9000 });

    expect(client.tokenInputs[0].allowedPorts).toEqual([{ port: 9000 }]);
    expect(endpoint.requests[0].headers["X-aws-proxy-port"]).toBe("9000");
  }, 30_000);

  it("accepts an input larger than the run hook limit", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const input = { blob: "x".repeat(10_000) };

    const { execution } = await run(client, endpoint, { path: "/job" }, input);

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(endpoint.requests[0].body.input).toEqual(input);
  });

  it.each<[string, MicrovmConfig["request"], string]>([
    ["a path without a leading slash", { path: "job" }, "the request path"],
    [
      "a lifecycle hook path",
      { path: "/aws/lambda-microvms/runtime/v1/run" },
      "lifecycle hook prefix",
    ],
    ["an invalid port", { path: "/job", port: 0 }, "the request port"],
    [
      "a NaN retry window",
      { path: "/job", retryWindow: { seconds: Number.NaN } },
      "the request retryWindow",
    ],
    [
      "a zero retry window",
      { path: "/job", retryWindow: { seconds: 0 } },
      "the request retryWindow",
    ],
    [
      "a retry window over 10 minutes",
      { path: "/job", retryWindow: { minutes: 11 } },
      "the request retryWindow",
    ],
  ])(
    "rejects %s before any durable operation",
    async (_label, request, message) => {
      const client = new FakeMicrovmsClient();
      const endpoint = new FakeEndpoint();

      const { execution } = await run(client, endpoint, request, {}, null);

      expect(execution.getStatus()).toBe("FAILED");
      expect(execution.getError()?.errorMessage).toContain(message);
      expect(execution.getOperations()).toHaveLength(0);
    },
  );

  it("fails before any durable operation when the Region cannot be determined", async () => {
    const saved = process.env.AWS_REGION;
    delete process.env.AWS_REGION;
    try {
      const client = new FakeMicrovmsClient();
      const handler = withDurableExecution(
        async (_event: unknown, context: DurableContext) =>
          microvm(context, "build", {}, baseConfig(client)),
      );
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });

      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe("FAILED");
      expect(execution.getError()?.errorMessage).toContain(
        "cannot determine the AWS Region",
      );
      expect(execution.getOperations()).toHaveLength(0);
    } finally {
      process.env.AWS_REGION = saved;
    }
  });
});
