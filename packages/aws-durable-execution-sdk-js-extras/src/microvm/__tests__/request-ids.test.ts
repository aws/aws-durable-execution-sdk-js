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
  GetMicrovmCommand,
  ResourceNotFoundException,
  ThrottlingException,
  ValidationException,
} from "@aws-sdk/client-lambda-microvms";
import {
  MicrovmDeliveryError,
  MicrovmLaunchError,
  MicrovmNotRunningError,
  microvm,
  microvmSession,
} from "..";
import { MicrovmStateError } from "../aws-errors";
import { sendJob } from "../request";
import type { RetryStrategy } from "../shared";
import {
  baseConfig,
  FakeEndpoint,
  FakeMicrovmsClient,
  FakeStsServiceException,
  type Handler,
  throwing,
} from "./fakes";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

/**
 * The operation that a scenario runs:
 *
 * - `microvm`: one job over HTTP, because the config sets `request.path`.
 * - `session`: a session with the default config. It makes no GetMicrovm
 *   call.
 * - `checking session`: a session with `autoSuspendOnIdle: true`. It calls
 *   GetMicrovm before each job.
 */
type Kind = "microvm" | "session" | "checking session";

type Metadata = { $metadata: Record<string, unknown> };

const WITH_ID: Metadata = {
  $metadata: { httpStatusCode: 400, requestId: "req-1" },
};
const WITHOUT_ID: Metadata = { $metadata: { httpStatusCode: 400 } };

/** Runs one operation, catches its error, and replays the failure once. */
function runCatching(
  kind: Kind,
  client: FakeMicrovmsClient,
  endpoint: FakeEndpoint,
  retryStrategy?: RetryStrategy,
): { runner: LocalDurableTestRunner<unknown>; caught: unknown[] } {
  const caught: unknown[] = [];
  const config = {
    ...baseConfig(client),
    fetch: endpoint.fetch,
    ...(retryStrategy && { retryStrategy }),
  };
  const runner = new LocalDurableTestRunner({
    handlerFunction: withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        try {
          if (kind === "microvm") {
            await microvm(context, "job", 1, {
              ...config,
              request: { path: "/job" },
            });
          } else {
            await microvmSession(
              context,
              "pipeline",
              {
                ...config,
                timeout: { hours: 1 },
                autoSuspendOnIdle: kind === "checking session",
              },
              (vm, ctx) =>
                vm.invoke(ctx, "job", 1, {
                  path: "/job",
                  timeout: { minutes: 10 },
                }),
            );
          }
          return "unexpected";
        } catch (error) {
          caught.push(error);
        }
        // A pending callback ends the invocation. The next invocation replays
        // the failed operation from its checkpoint and catches the error
        // again.
        const [resumed] = await context.createCallback("go");
        await resumed;
        return "caught";
      },
    ),
  }) as LocalDurableTestRunner<unknown>;
  return { runner, caught };
}

async function runAndReplay(
  runner: LocalDurableTestRunner<unknown>,
): Promise<void> {
  const executionPromise = runner.run({ payload: {} });
  const go = runner.getOperation("go");
  await go.waitForData(WaitingOperationStatus.STARTED);
  await go.sendCallbackSuccess(JSON.stringify("go"));
  const execution = await executionPromise;
  expect(execution.getStatus()).toBe("SUCCEEDED");
  expect(execution.getResult()).toBe("caught");
}

const removed =
  "MicroVM mvm-1 no longer exists. A MicroVM lives at most its `timeout` plus 5 minutes, and never longer than 8 hours.";
const delivery = 'MicroVM "job": the job could not be delivered: ';
const launchFailed = 'MicroVM "job": the launch failed: ';

const token = (): Handler => async () => ({
  authToken: { "X-aws-proxy-auth": "token" },
});
const getCount = (client: FakeMicrovmsClient): number =>
  client.events.filter((e) => e.startsWith("get:")).length;

interface Scenario {
  kind: Kind;
  setup: (
    client: FakeMicrovmsClient,
    endpoint: FakeEndpoint,
    meta: Metadata,
  ) => void;
  errorClass: typeof MicrovmLaunchError | typeof MicrovmDeliveryError;
  notRunning: boolean;
  /** The prefix that the MicroVM error adds to the step message. */
  prefix: string;
  /** The failed step. */
  step: "job.launch" | "job.request";
  /** The error type that the step checkpoints. */
  stepErrorType: string;
  /** The step message without and with the request ID `req-1`. */
  stepMessage: [string, string];
  /** The number of calls of the failing operation. 1 means no retry. */
  calls: (client: FakeMicrovmsClient) => number;
  expectedCalls: number;
}

const scenarios: Record<string, Scenario> = {
  "CreateMicrovmAuthToken reports the MicroVM removed, for the first token of a session job":
    {
      kind: "session",
      setup: (client, _endpoint, meta) => {
        client.tokenResponses = [
          throwing(new ResourceNotFoundException({ message: "gone", ...meta })),
        ];
      },
      errorClass: MicrovmNotRunningError,
      notRunning: true,
      prefix: delivery,
      step: "job.request",
      stepErrorType: "MicrovmStateError",
      stepMessage: [
        removed,
        `${removed} CreateMicrovmAuthToken request ID: req-1.`,
      ],
      calls: (client) => client.tokenInputs.length,
      expectedCalls: 1,
    },
  "CreateMicrovmAuthToken reports the MicroVM removed, for the new token after a 401":
    {
      kind: "session",
      setup: (client, endpoint, meta) => {
        endpoint.responses = [401];
        client.tokenResponses = [
          token(),
          throwing(new ResourceNotFoundException({ message: "gone", ...meta })),
        ];
      },
      errorClass: MicrovmNotRunningError,
      notRunning: true,
      prefix: delivery,
      step: "job.request",
      stepErrorType: "MicrovmStateError",
      stepMessage: [
        removed,
        `${removed} CreateMicrovmAuthToken request ID: req-1.`,
      ],
      calls: (client) => client.tokenInputs.length,
      expectedCalls: 2,
    },
  "CreateMicrovmAuthToken reports the MicroVM removed, in a session that checks the state":
    {
      kind: "checking session",
      setup: (client, _endpoint, meta) => {
        client.tokenResponses = [
          throwing(new ResourceNotFoundException({ message: "gone", ...meta })),
        ];
      },
      errorClass: MicrovmNotRunningError,
      notRunning: true,
      prefix: delivery,
      step: "job.request",
      stepErrorType: "MicrovmStateError",
      stepMessage: [
        removed,
        `${removed} CreateMicrovmAuthToken request ID: req-1.`,
      ],
      calls: (client) => client.tokenInputs.length,
      expectedCalls: 1,
    },
  "CreateMicrovmAuthToken reports the MicroVM removed, for a microvm job": {
    kind: "microvm",
    setup: (client, _endpoint, meta) => {
      client.tokenResponses = [
        throwing(new ResourceNotFoundException({ message: "gone", ...meta })),
      ];
    },
    errorClass: MicrovmNotRunningError,
    notRunning: true,
    prefix: delivery,
    step: "job.request",
    stepErrorType: "MicrovmStateError",
    stepMessage: [
      removed,
      `${removed} CreateMicrovmAuthToken request ID: req-1.`,
    ],
    calls: (client) => client.tokenInputs.length,
    expectedCalls: 1,
  },
  // The request ID of an STS error belongs to STS. So the message names no
  // RunMicrovm request ID, with or without a request ID on the error.
  "the credential provider's STS call fails inside RunMicrovm": {
    kind: "microvm",
    setup: (client, _endpoint, meta) => {
      client.runResponses = [
        throwing(
          new FakeStsServiceException(
            "not authorized to assume role",
            meta.$metadata,
          ),
        ),
      ];
    },
    errorClass: MicrovmLaunchError,
    notRunning: false,
    prefix: launchFailed,
    step: "job.launch",
    stepErrorType: "AccessDenied",
    stepMessage: [
      "not authorized to assume role",
      "not authorized to assume role",
    ],
    calls: (client) => client.runInputs.length,
    expectedCalls: 1,
  },
  "GetMicrovm reports a terminated MicroVM": {
    kind: "checking session",
    setup: (client, _endpoint, meta) => {
      client.getResponses = [
        async () => ({
          state: "TERMINATED",
          stateReason: "MaximumDuration",
          ...meta,
        }),
      ];
    },
    errorClass: MicrovmNotRunningError,
    notRunning: true,
    prefix: delivery,
    step: "job.request",
    stepErrorType: "MicrovmStateError",
    stepMessage: [
      "MicroVM mvm-1 is TERMINATED: MaximumDuration.",
      "MicroVM mvm-1 is TERMINATED: MaximumDuration. GetMicrovm request ID: req-1.",
    ],
    calls: getCount,
    expectedCalls: 1,
  },
  "GetMicrovm reports a terminating MicroVM without a reason": {
    kind: "checking session",
    setup: (client, _endpoint, meta) => {
      client.getResponses = [async () => ({ state: "TERMINATING", ...meta })];
    },
    errorClass: MicrovmNotRunningError,
    notRunning: true,
    prefix: delivery,
    step: "job.request",
    stepErrorType: "MicrovmStateError",
    stepMessage: [
      "MicroVM mvm-1 is TERMINATING.",
      "MicroVM mvm-1 is TERMINATING. GetMicrovm request ID: req-1.",
    ],
    calls: getCount,
    expectedCalls: 1,
  },
  "RunMicrovm rejects the launch": {
    kind: "microvm",
    setup: (client, _endpoint, meta) => {
      client.runResponses = [
        throwing(new ValidationException({ message: "bad image", ...meta })),
      ];
    },
    errorClass: MicrovmLaunchError,
    notRunning: false,
    prefix: launchFailed,
    step: "job.launch",
    stepErrorType: "ValidationException",
    stepMessage: ["bad image", "bad image. RunMicrovm request ID: req-1."],
    calls: (client) => client.runInputs.length,
    expectedCalls: 1,
  },
  "RunMicrovm returns no microvmId": {
    kind: "microvm",
    setup: (client, _endpoint, meta) => {
      client.runResponses = [async () => ({ ...meta })];
    },
    errorClass: MicrovmLaunchError,
    notRunning: false,
    prefix: launchFailed,
    step: "job.launch",
    stepErrorType: "Error",
    stepMessage: [
      "RunMicrovm returned no microvmId",
      "RunMicrovm returned no microvmId. RunMicrovm request ID: req-1.",
    ],
    calls: (client) => client.runInputs.length,
    expectedCalls: 1,
  },
  "RunMicrovm returns no endpoint for HTTP delivery": {
    kind: "microvm",
    setup: (client, _endpoint, meta) => {
      client.runResponses = [async () => ({ microvmId: "mvm-1", ...meta })];
    },
    errorClass: MicrovmLaunchError,
    notRunning: false,
    prefix: launchFailed,
    step: "job.launch",
    stepErrorType: "Error",
    stepMessage: [
      "RunMicrovm returned no endpoint",
      "RunMicrovm returned no endpoint. RunMicrovm request ID: req-1.",
    ],
    calls: (client) => client.runInputs.length,
    expectedCalls: 1,
  },
  "GetMicrovm denies access": {
    kind: "checking session",
    setup: (client, _endpoint, meta) => {
      client.getResponses = [
        throwing(new AccessDeniedException({ message: "denied", ...meta })),
      ];
    },
    errorClass: MicrovmDeliveryError,
    notRunning: false,
    prefix: delivery,
    step: "job.request",
    stepErrorType: "AccessDeniedException",
    stepMessage: ["denied", "denied. GetMicrovm request ID: req-1."],
    // A thrown GetMicrovm records no event. So the test counts the calls
    // with its own handler.
    calls: (client) => (client as unknown as { getCalls: number }).getCalls,
    expectedCalls: 1,
  },
  "ResumeMicrovm denies access": {
    kind: "checking session",
    setup: (client, _endpoint, meta) => {
      client.getResponses = [async () => ({ state: "SUSPENDED" })];
      client.resumeResponses = [
        throwing(new AccessDeniedException({ message: "denied", ...meta })),
      ];
    },
    errorClass: MicrovmDeliveryError,
    notRunning: false,
    prefix: delivery,
    step: "job.request",
    stepErrorType: "AccessDeniedException",
    stepMessage: ["denied", "denied. ResumeMicrovm request ID: req-1."],
    calls: (client) => client.events.filter((e) => e === "resume").length,
    expectedCalls: 1,
  },
  "CreateMicrovmAuthToken denies access": {
    kind: "microvm",
    setup: (client, _endpoint, meta) => {
      client.tokenResponses = [
        throwing(new AccessDeniedException({ message: "denied", ...meta })),
      ];
    },
    errorClass: MicrovmDeliveryError,
    notRunning: false,
    prefix: delivery,
    step: "job.request",
    stepErrorType: "AccessDeniedException",
    stepMessage: [
      "denied",
      "denied. CreateMicrovmAuthToken request ID: req-1.",
    ],
    calls: (client) => client.tokenInputs.length,
    expectedCalls: 1,
  },
  "CreateMicrovmAuthToken returns no authToken": {
    kind: "session",
    setup: (client, _endpoint, meta) => {
      client.tokenResponses = [async () => ({ ...meta })];
    },
    errorClass: MicrovmDeliveryError,
    notRunning: false,
    prefix: delivery,
    step: "job.request",
    stepErrorType: "Error",
    stepMessage: [
      "CreateMicrovmAuthToken returned no authToken",
      "CreateMicrovmAuthToken returned no authToken. CreateMicrovmAuthToken request ID: req-1.",
    ],
    calls: (client) => client.tokenInputs.length,
    expectedCalls: 1,
  },
};

/** A fake client that also counts GetMicrovm calls, including failed ones. */
function countingClient(): FakeMicrovmsClient {
  const client = new FakeMicrovmsClient();
  const counted = client as unknown as { getCalls: number };
  counted.getCalls = 0;
  const send = client.send.bind(client);
  client.send = async (command, options) => {
    if (command instanceof GetMicrovmCommand) {
      counted.getCalls++;
    }
    return send(command, options);
  };
  return client;
}

describe("the request ID of a failed AWS call", () => {
  describe.each(Object.entries(scenarios))("when %s", (_label, scenario) => {
    it.each<[string, Metadata, 0 | 1]>([
      ["with a request ID", WITH_ID, 1],
      ["without a request ID", WITHOUT_ID, 0],
    ])(
      "shows the handler the step message %s, on the first run and on replay, without a retry",
      async (_idLabel, meta, withId) => {
        const client = countingClient();
        const endpoint = new FakeEndpoint();
        scenario.setup(client, endpoint, meta);
        const { runner, caught } = runCatching(scenario.kind, client, endpoint);

        await runAndReplay(runner);

        const stepMessage = scenario.stepMessage[withId];
        const expected = `${scenario.prefix}${stepMessage}`;
        // The first entry is the first run. Each later entry is a replay.
        expect(caught.length).toBeGreaterThanOrEqual(2);
        for (const error of caught) {
          expect(error).toBeInstanceOf(scenario.errorClass);
          expect(error instanceof MicrovmNotRunningError).toBe(
            scenario.notRunning,
          );
          expect((error as Error).message).toBe(expected);
        }
        // The execution history keeps the same message.
        expect(
          runner.getOperation(scenario.step).getStepDetails()?.error,
        ).toMatchObject({
          errorType: scenario.stepErrorType,
          errorMessage: stepMessage,
        });
        expect(
          runner.getOperation("job").getContextDetails()?.error,
        ).toMatchObject({ errorMessage: expected });
        // The default retry strategy fails the step at once.
        expect(scenario.calls(client)).toBe(scenario.expectedCalls);
      },
    );
  });
});

describe("retries of a failed AWS call with a request ID", () => {
  /** Answers each call with a new ThrottlingException, as the AWS SDK does. */
  const throttled = (withId: boolean): Handler[] =>
    Array.from({ length: 5 }, (_, i) =>
      throwing(
        new ThrottlingException({
          message: "slow down",
          $metadata: {
            httpStatusCode: 429,
            ...(withId && { requestId: `req-${i + 1}` }),
          },
        }),
      ),
    );

  it.each<[string, boolean, string]>([
    [
      "with a request ID",
      true,
      "slow down. CreateMicrovmAuthToken request ID: req-5.",
    ],
    ["without a request ID", false, "slow down"],
  ])(
    "retries a throttled CreateMicrovmAuthToken 5 times %s, and reports the last call",
    async (_label, withId, stepMessage) => {
      const client = new FakeMicrovmsClient();
      const endpoint = new FakeEndpoint();
      client.tokenResponses = throttled(withId);
      const { runner, caught } = runCatching("session", client, endpoint);

      await runAndReplay(runner);

      expect(client.tokenInputs).toHaveLength(5);
      expect(endpoint.requests).toHaveLength(0);
      for (const error of caught) {
        expect(error).toBeInstanceOf(MicrovmDeliveryError);
        expect(error).not.toBeInstanceOf(MicrovmNotRunningError);
        expect((error as Error).message).toBe(`${delivery}${stepMessage}`);
      }
    },
  );

  it.each<[string, boolean, string]>([
    ["with a request ID", true, "slow down. RunMicrovm request ID: req-5."],
    ["without a request ID", false, "slow down"],
  ])(
    "retries a throttled RunMicrovm 5 times %s, and reports the last call",
    async (_label, withId, stepMessage) => {
      const client = new FakeMicrovmsClient();
      client.runResponses = throttled(withId);
      const { runner, caught } = runCatching(
        "microvm",
        client,
        new FakeEndpoint(),
      );

      await runAndReplay(runner);

      expect(client.runInputs).toHaveLength(5);
      for (const error of caught) {
        expect(error).toBeInstanceOf(MicrovmLaunchError);
        expect((error as Error).message).toBe(`${launchFailed}${stepMessage}`);
      }
    },
  );

  it("names the request ID once when a custom client throws one error object for every call", async () => {
    const client = new FakeMicrovmsClient();
    const error = new ThrottlingException({
      message: "slow down",
      $metadata: { httpStatusCode: 429, requestId: "req-1" },
    });
    client.runResponses = Array.from({ length: 5 }, () => throwing(error));
    const { runner, caught } = runCatching(
      "microvm",
      client,
      new FakeEndpoint(),
    );

    await runAndReplay(runner);

    expect(client.runInputs).toHaveLength(5);
    expect(error.message).toBe("slow down. RunMicrovm request ID: req-1.");
    for (const caughtError of caught) {
      expect((caughtError as Error).message).toBe(
        `${launchFailed}slow down. RunMicrovm request ID: req-1.`,
      );
    }
  });

  it("names only the last request ID when one error object gets a new request ID on each call", async () => {
    const client = new FakeMicrovmsClient();
    const error = new ThrottlingException({
      message: "Rate exceeded",
      $metadata: { httpStatusCode: 429 },
    });
    client.runResponses = Array.from({ length: 5 }, (_, i) => async () => {
      error.$metadata.requestId = `r-${i + 1}`;
      throw error;
    });
    const { runner, caught } = runCatching(
      "microvm",
      client,
      new FakeEndpoint(),
    );

    await runAndReplay(runner);

    expect(client.runInputs).toHaveLength(5);
    for (const caughtError of caught) {
      expect((caughtError as Error).message).toBe(
        `${launchFailed}Rate exceeded. RunMicrovm request ID: r-5.`,
      );
    }
    expect(
      runner.getOperation("job.launch").getStepDetails()?.error,
    ).toMatchObject({
      errorMessage: "Rate exceeded. RunMicrovm request ID: r-5.",
    });
  });

  it("gives a custom retry strategy the AWS SDK error itself, with its class, its retry fields, and its original message", async () => {
    const client = new FakeMicrovmsClient();
    const errors = throttled(true);
    client.tokenResponses = errors;
    const seen: unknown[] = [];
    const seenMessages: string[] = [];
    const retryStrategy: RetryStrategy = (error, attemptCount) => {
      seen.push(error);
      seenMessages.push(error.message);
      return { shouldRetry: attemptCount < 2, delay: { seconds: 1 } };
    };
    const { runner, caught } = runCatching(
      "session",
      client,
      new FakeEndpoint(),
      retryStrategy,
    );

    await runAndReplay(runner);

    // The launch succeeded, so the strategy saw only the two token errors.
    expect(seen).toHaveLength(2);
    // The strategy decided on the AWS SDK message. After it returned, each
    // error has the message with its request ID again.
    expect(seenMessages).toEqual(["slow down", "slow down"]);
    seen.forEach((error, i) => {
      expect(error).toBeInstanceOf(ThrottlingException);
      expect(error).toMatchObject({
        name: "ThrottlingException",
        $fault: "client",
        $retryable: { throttling: true },
        $metadata: { requestId: `req-${i + 1}` },
        message: `slow down. CreateMicrovmAuthToken request ID: req-${i + 1}.`,
      });
    });
    for (const error of caught) {
      expect((error as Error).message).toBe(
        `${delivery}slow down. CreateMicrovmAuthToken request ID: req-2.`,
      );
    }
  });
});

describe("the request ID of a failed TerminateMicrovm call", () => {
  it.each<[string, Metadata, string]>([
    [
      "with a request ID",
      WITH_ID,
      "denied. TerminateMicrovm request ID: req-1.",
    ],
    ["without a request ID", WITHOUT_ID, "denied"],
  ])(
    "keeps the job result, and records the message %s",
    async (_label, meta, message) => {
      const client = new FakeMicrovmsClient();
      client.terminateResponses = [
        throwing(new AccessDeniedException({ message: "denied", ...meta })),
      ];
      const runner = new LocalDurableTestRunner({
        handlerFunction: withDurableExecution(
          async (_event: unknown, context: DurableContext) =>
            microvm(context, "build", 1, baseConfig(client)),
        ),
      });

      const executionPromise = runner.run({ payload: {} });
      const callback = runner.getOperation("build.callback");
      await callback.waitForData(WaitingOperationStatus.STARTED);
      await callback.sendCallbackSuccess(JSON.stringify("ok"));
      const execution = await executionPromise;

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getResult()).toBe("ok");
      expect(client.terminateInputs).toHaveLength(1);
      expect(
        runner.getOperation("build.terminate").getStepDetails()?.error,
      ).toMatchObject({
        errorType: "AccessDeniedException",
        errorMessage: message,
      });
    },
  );
});

describe("one error object that a custom client throws for two operations", () => {
  it("names only TerminateMicrovm in the terminate record, after CreateMicrovmAuthToken threw the same object", async () => {
    const client = new FakeMicrovmsClient();
    const shared = new AccessDeniedException({
      message: "denied",
      $metadata: { httpStatusCode: 403, requestId: "shared-1" },
    });
    client.tokenResponses = [throwing(shared)];
    client.terminateResponses = [throwing(shared)];
    const { runner, caught } = runCatching(
      "session",
      client,
      new FakeEndpoint(),
    );

    await runAndReplay(runner);

    for (const error of caught) {
      expect((error as Error).message).toBe(
        `${delivery}denied. CreateMicrovmAuthToken request ID: shared-1.`,
      );
    }
    expect(
      runner.getOperation("pipeline.terminate").getStepDetails()?.error,
    ).toMatchObject({
      errorType: "AccessDeniedException",
      errorMessage: "denied. TerminateMicrovm request ID: shared-1.",
    });
    expect(shared.message).toBe(
      "denied. TerminateMicrovm request ID: shared-1.",
    );
  });
});

describe("sendJob when CreateMicrovmAuthToken reports the MicroVM removed", () => {
  it.each<[string, number[], Handler[]]>([
    ["for the first token", [], []],
    ["for the new token after a 403", [403], [token()]],
  ])(
    "throws MicrovmStateError %s, with the AWS SDK error as the cause",
    async (_label, responses, before) => {
      const client = new FakeMicrovmsClient();
      const endpoint = new FakeEndpoint();
      endpoint.responses = [...responses];
      const notFound = new ResourceNotFoundException({
        message: "gone",
        $metadata: { httpStatusCode: 404, requestId: "req-1" },
      });
      client.tokenResponses = [...before, throwing(notFound)];

      const error = await sendJob({
        client: client.asClient(),
        fetch: endpoint.fetch,
        microvmId: "mvm-1",
        endpoint: "mvm-1.example",
        path: "/job",
        port: 8080,
        body: "{}",
        retryWindowMs: 60_000,
        log: jest.fn(),
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MicrovmStateError);
      expect(error).toMatchObject({
        name: "MicrovmStateError",
        state: undefined,
        message: `${removed} CreateMicrovmAuthToken request ID: req-1.`,
        cause: notFound,
      });
      expect(endpoint.requests).toHaveLength(responses.length);
    },
  );
});
