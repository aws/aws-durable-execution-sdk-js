import { createHash } from "node:crypto";
import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { ThrottlingException } from "@aws-sdk/client-lambda-microvms";
import {
  DEFAULT_MICROVM_JOB_PATH,
  type MicrovmSessionConfig,
  type MicrovmSessionHandler,
  microvmSession,
} from "..";
import {
  baseConfig,
  FakeEndpoint,
  FakeMicrovmsClient,
  metadata,
  throwing,
} from "./fakes";

type Runner = LocalDurableTestRunner<unknown>;

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

const sessionConfig = (
  client: FakeMicrovmsClient,
  endpoint: FakeEndpoint,
  overrides: Partial<MicrovmSessionConfig> = {},
): MicrovmSessionConfig => ({
  ...baseConfig(client),
  timeout: { hours: 1 },
  fetch: endpoint.fetch,
  ...overrides,
});

const job = (path: string) => ({ path, timeout: { minutes: 10 } });

/** Waits until the job is delivered, then completes its callback. */
async function complete(
  runner: Runner,
  jobName: string,
  outcome: { result: unknown } | { error: string },
): Promise<void> {
  const callback = runner.getOperation(`${jobName}.callback`);
  await callback.waitForData(WaitingOperationStatus.STARTED);
  await runner
    .getOperation(`${jobName}.request`)
    .waitForData(WaitingOperationStatus.COMPLETED);
  if ("result" in outcome) {
    await callback.sendCallbackSuccess(JSON.stringify(outcome.result));
  } else {
    await callback.sendCallbackFailure({
      ErrorType: "JobFailed",
      ErrorMessage: outcome.error,
    });
  }
}

function runnerFor(
  client: FakeMicrovmsClient,
  endpoint: FakeEndpoint,
  handler: MicrovmSessionHandler<unknown>,
  overrides: Partial<MicrovmSessionConfig> = {},
): Runner {
  return new LocalDurableTestRunner({
    handlerFunction: withDurableExecution(
      async (_event: unknown, context: DurableContext) =>
        microvmSession(
          context,
          "pipeline",
          sessionConfig(client, endpoint, overrides),
          handler,
        ),
    ),
  }) as Runner;
}

describe("microvmSession", () => {
  it("sends a job without a path to the default job path", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = runnerFor(client, endpoint, async (vm, ctx) =>
      vm.invoke(
        ctx,
        "build",
        { repo: "org/app" },
        { timeout: { minutes: 10 } },
      ),
    );

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", { result: "built" });
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toBe("built");
    expect(endpoint.requests.map((r) => new URL(r.url).pathname)).toEqual([
      DEFAULT_MICROVM_JOB_PATH,
    ]);
  });

  it("sends two jobs to one MicroVM and returns the handler's value", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = runnerFor(client, endpoint, async (vm, ctx) => {
      const build = await vm.invoke<{ artifact: string }>(
        ctx,
        "clone-build",
        { repo: "org/app" },
        job("/clone-build"),
      );
      const tests = await vm.invoke(ctx, "test", { build }, job("/test"));
      return { build, tests, microvmId: vm.microvmId };
    });

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "clone-build", { result: { artifact: "a.tgz" } });
    await complete(runner, "test", { result: { passed: 12 } });
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({
      build: { artifact: "a.tgz" },
      tests: { passed: 12 },
      microvmId: "mvm-1",
    });

    // One MicroVM for the whole session, across every replay.
    expect(client.runInputs).toHaveLength(1);
    const sessionId = runner.getOperation("pipeline.session").getStepDetails()
      ?.result as string;
    expect(client.runInputs[0].clientToken).toBe(
      createHash("sha256").update(sessionId).digest("hex"),
    );
    const region = process.env.AWS_REGION ?? "";
    expect(client.runInputs[0].ingressNetworkConnectors).toEqual([
      `arn:aws:lambda:${region}:aws:network-connector:aws-network-connector:ALL_INGRESS`,
    ]);
    // Suspending is off by default. So the payload asks for no suspend.
    expect(client.payload()).toEqual({ version: 1, region });

    // Each job has its own callback and is delivered once.
    expect(endpoint.requests.map((r) => r.url)).toEqual([
      "https://mvm-1.lambda-microvm.us-east-1.on.aws/clone-build",
      "https://mvm-1.lambda-microvm.us-east-1.on.aws/test",
    ]);
    const [first, second] = endpoint.requests.map((r) => r.body);
    expect(first.input).toEqual({ repo: "org/app" });
    expect(second.input).toEqual({ build: { artifact: "a.tgz" } });
    expect(first.callbackId).not.toBe(second.callbackId);

    expect(client.terminateInputs).toEqual([{ microvmIdentifier: "mvm-1" }]);
  });

  it("allows durable waits between jobs", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = runnerFor(client, endpoint, async (vm, ctx) => {
      const first = await vm.invoke(ctx, "first", 1, job("/job"));
      await ctx.wait("pause", { minutes: 30 });
      const second = await vm.invoke(ctx, "second", 2, job("/job"));
      return [first, second];
    });

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "first", { result: "one" });
    await complete(runner, "second", { result: "two" });
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual(["one", "two"]);
    expect(client.runInputs).toHaveLength(1);
    expect(endpoint.requests).toHaveLength(2);
  });

  it("runs jobs in parallel with the promise combinators", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = runnerFor(client, endpoint, async (vm, ctx) =>
      ctx.promise.all([
        vm.invoke(ctx, "left", "L", job("/job")),
        vm.invoke(ctx, "right", "R", job("/job")),
      ]),
    );

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "right", { result: "r" });
    await complete(runner, "left", { result: "l" });
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual(["l", "r"]);
    expect(client.runInputs).toHaveLength(1);
    expect(endpoint.requests).toHaveLength(2);
  });

  it("reports a failed parallel job as PromiseCombinatorError, with the MicroVM type only in the cause chain", async () => {
    // ctx.promise.all maps every failure to PromiseCombinatorError. The
    // checkpoint of the failed session keeps only that outer type. So the
    // caller of the session sees no MicroVM type at all.
    const chain = (error: unknown): string[] => {
      const names: string[] = [];
      for (let e = error; e instanceof Error; e = e.cause) {
        names.push(`${e.constructor.name}(${e.name})`);
      }
      return names;
    };
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    let inside: string[] | undefined;
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) =>
          microvmSession(
            context,
            "pipeline",
            sessionConfig(client, endpoint),
            async (vm, ctx) => {
              try {
                return await ctx.promise.all([
                  vm.invoke(ctx, "left", "L", job("/job")),
                  vm.invoke(ctx, "right", "R", job("/job")),
                ]);
              } catch (error) {
                inside = chain(error);
                throw error;
              }
            },
          ).catch((error: unknown) => ({ inside, outside: chain(error) })),
      ),
    });

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "left", { result: "l" });
    await complete(runner, "right", { error: "disk full" });
    const execution = await executionPromise;

    expect(execution.getResult()).toEqual({
      inside: [
        "PromiseCombinatorError(PromiseCombinatorError)",
        "StepError(StepError)",
        "Error(MicrovmJobFailedError)",
      ],
      outside: [
        "PromiseCombinatorError(PromiseCombinatorError)",
        "Error(PromiseCombinatorError)",
      ],
    });
  });

  it("runs jobs from map items with each item's context", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = runnerFor(client, endpoint, async (vm, ctx) => {
      const batch = await ctx.map("shards", [0, 1], (itemCtx, shard) =>
        vm.invoke(itemCtx, `shard-${shard}`, shard, job("/job")),
      );
      return batch.getResults();
    });

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "shard-0", { result: "s0" });
    await complete(runner, "shard-1", { result: "s1" });
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual(["s0", "s1"]);
    expect(client.runInputs).toHaveLength(1);
  });

  it("rejects an invoke without a durable context as its first argument", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = runnerFor(client, endpoint, async (vm) => {
      // The shape before the context came first: vm.invoke(name, input, options).
      const invoke = vm.invoke as unknown as (
        ...args: unknown[]
      ) => Promise<unknown>;
      return invoke("build", null, job("/job")).catch(
        (error: Error) => `${error.name}: ${error.message}`,
      );
    });

    const execution = await runner.run({ payload: {} });

    expect(execution.getResult()).toBe(
      'TypeError: MicroVM session "pipeline": invoke requires the durable context to create the job in, as its first argument',
    );
    expect(endpoint.requests).toHaveLength(0);
  });

  it("lets the handler catch a failed job and continue on the same MicroVM", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = runnerFor(client, endpoint, async (vm, ctx) => {
      try {
        await vm.invoke(ctx, "flaky", null, job("/job"));
        return "unexpected";
      } catch (error) {
        const recovered = await vm.invoke(ctx, "fallback", null, job("/job"));
        return { caught: (error as Error).message, recovered };
      }
    });

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "flaky", { error: "disk full" });
    await complete(runner, "fallback", { result: "ok" });
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({
      caught: expect.stringContaining("disk full"),
      recovered: "ok",
    });
    expect(client.runInputs).toHaveLength(1);
    expect(client.terminateInputs).toHaveLength(1);
  });

  it("fails with an uncaught job error and still terminates the MicroVM", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = runnerFor(client, endpoint, async (vm, ctx) =>
      vm.invoke(ctx, "build", null, job("/job")),
    );

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", { error: "compile error" });
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()?.errorMessage).toContain("compile error");
    expect(client.terminateInputs).toEqual([{ microvmIdentifier: "mvm-1" }]);
  });

  it("fails with the handler's own error and still terminates the MicroVM", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = runnerFor(client, endpoint, async () => {
      throw new Error("handler gave up");
    });

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()?.errorMessage).toContain("handler gave up");
    expect(client.runInputs).toHaveLength(1);
    expect(client.terminateInputs).toHaveLength(1);
  });

  it("rejects an invalid job inside the handler, where the handler can catch it", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = runnerFor(client, endpoint, async (vm, ctx) => {
      const errors: string[] = [];
      for (const options of [
        { path: "no-slash", timeout: { minutes: 1 } },
        { path: "/job", timeout: { hours: 9 } },
        {
          path: "/job",
          timeout: { minutes: 1 },
          retryWindow: { seconds: Number.NaN },
        },
      ]) {
        try {
          await vm.invoke(ctx, "bad", null, options);
        } catch (error) {
          errors.push((error as Error).name);
        }
      }
      return errors;
    });

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual([
      "TypeError",
      "RangeError",
      "RangeError",
    ]);
    expect(endpoint.requests).toHaveLength(0);
  });

  it("retries a throttled launch with the same client token", async () => {
    const client = new FakeMicrovmsClient();
    client.runResponses = [
      throwing(new ThrottlingException({ message: "slow down", ...metadata })),
    ];
    const endpoint = new FakeEndpoint();
    const runner = runnerFor(client, endpoint, async (vm, ctx) =>
      vm.invoke(ctx, "only", null, job("/job")),
    );

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "only", { result: 1 });
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.runInputs).toHaveLength(2);
    expect(client.runInputs[1].clientToken).toBe(
      client.runInputs[0].clientToken,
    );
  });

  it("passes an idle policy through to RunMicrovm", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const idlePolicy = {
      autoResumeEnabled: true,
      maxIdleDurationSeconds: 3_600,
      suspendedDurationSeconds: 900,
    };
    const runner = runnerFor(client, endpoint, async () => "done", {
      idlePolicy,
    });

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.runInputs[0].idlePolicy).toEqual(idlePolicy);
  });

  it.each<[string, Partial<MicrovmSessionConfig>, string]>([
    ["a timeout above 8 hours", { timeout: { hours: 9 } }, "timeout must be"],
    ["an empty image", { imageIdentifier: "" }, "imageIdentifier is required"],
  ])(
    "rejects %s before any durable operation",
    async (_label, overrides, message) => {
      const client = new FakeMicrovmsClient();
      const endpoint = new FakeEndpoint();
      const runner = runnerFor(client, endpoint, async () => "x", overrides);

      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe("FAILED");
      expect(execution.getError()?.errorMessage).toContain(message);
      expect(execution.getOperations()).toHaveLength(0);
    },
  );
});
