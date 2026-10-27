import {
  createRetryStrategy,
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import {
  AccessDeniedException,
  ThrottlingException,
} from "@aws-sdk/client-lambda-microvms";
import {
  defaultMicrovmRetryStrategy,
  MicrovmDeliveryError,
  MicrovmLaunchError,
  microvm,
  microvmSession,
} from "..";
import { addRequestId } from "../aws-errors";
import { createScope, type RetryStrategy } from "../shared";
import {
  baseConfig,
  FakeEndpoint,
  FakeMicrovmsClient,
  FakeStsServiceException,
  type Handler,
} from "./fakes";

// A caller's retry strategy decides on the message that the AWS SDK error had
// before the step added the request ID. The handler and the execution history
// still get the message with the request ID of the last call.

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

/** The operation whose AWS call fails. */
type Call = "RunMicrovm" | "CreateMicrovmAuthToken";

const prefix: Record<Call, string> = {
  RunMicrovm: 'MicroVM "job": the launch failed: ',
  CreateMicrovmAuthToken: 'MicroVM "job": the job could not be delivered: ',
};
const stepName: Record<Call, string> = {
  RunMicrovm: "job.launch",
  CreateMicrovmAuthToken: "job.request",
};
const errorClass: Record<Call, typeof MicrovmLaunchError> = {
  RunMicrovm: MicrovmLaunchError,
  CreateMicrovmAuthToken: MicrovmDeliveryError,
};

/**
 * Answers each call with a new ThrottlingException "Rate exceeded", as the
 * AWS SDK does. Call `i` has the request ID `req-<i>`, unless `withId` is
 * false. `thrown` collects each error object.
 */
function throttled(
  withId: boolean,
  thrown: Error[] = [],
  count = 5,
): Handler[] {
  return Array.from({ length: count }, (_, i) => async () => {
    const error = new ThrottlingException({
      message: "Rate exceeded",
      $metadata: {
        httpStatusCode: 429,
        ...(withId && { requestId: `req-${i + 1}` }),
      },
    });
    thrown.push(error);
    throw error;
  });
}

function setup(client: FakeMicrovmsClient, call: Call, handlers: Handler[]) {
  if (call === "RunMicrovm") {
    client.runResponses = handlers;
  } else {
    client.tokenResponses = handlers;
  }
}

function callCount(client: FakeMicrovmsClient, call: Call): number {
  return call === "RunMicrovm"
    ? client.runInputs.length
    : client.tokenInputs.length;
}

/**
 * Runs one `microvm` job over HTTP, catches its error, and replays the
 * failure once. The second entry of `caught` is the replay.
 *
 * A strategy that throws leaves the step without a FAIL checkpoint. In that
 * case the local runner completes the execution in one invocation, and the
 * handler catches the error once. So that case passes `minCaught` 1.
 */
async function runAndReplay(
  client: FakeMicrovmsClient,
  retryStrategy: RetryStrategy,
  minCaught = 2,
): Promise<{ runner: LocalDurableTestRunner<unknown>; caught: unknown[] }> {
  const caught: unknown[] = [];
  const runner = new LocalDurableTestRunner({
    handlerFunction: withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        try {
          await microvm(context, "job", 1, {
            ...baseConfig(client),
            fetch: new FakeEndpoint().fetch,
            request: { path: "/job" },
            retryStrategy,
          });
          return "unexpected";
        } catch (error) {
          caught.push(error);
        }
        const [resumed] = await context.createCallback("go");
        await resumed;
        return "caught";
      },
    ),
  }) as LocalDurableTestRunner<unknown>;
  const executionPromise = runner.run({ payload: {} });
  const go = runner.getOperation("go");
  await go.waitForData(WaitingOperationStatus.STARTED);
  await go.sendCallbackSuccess(JSON.stringify("go"));
  const execution = await executionPromise;
  expect(execution.getStatus()).toBe("SUCCEEDED");
  expect(execution.getResult()).toBe("caught");
  expect(caught.length).toBeGreaterThanOrEqual(minCaught);
  return { runner, caught };
}

/** Wraps `strategy`, and records the message that it saw on each call. */
function recording(strategy: RetryStrategy): {
  strategy: RetryStrategy;
  seen: string[];
} {
  const seen: string[] = [];
  return {
    seen,
    strategy: (error, attemptCount) => {
      seen.push(error.message);
      return strategy(error, attemptCount);
    },
  };
}

function expectReported(
  runner: LocalDurableTestRunner<unknown>,
  caught: unknown[],
  call: Call,
  stepMessage: string,
): void {
  for (const error of caught) {
    expect(error).toBeInstanceOf(errorClass[call]);
    expect((error as Error).message).toBe(`${prefix[call]}${stepMessage}`);
  }
  expect(
    runner.getOperation(stepName[call]).getStepDetails()?.error,
  ).toMatchObject({
    errorType: "ThrottlingException",
    errorMessage: stepMessage,
  });
}

describe.each<Call>(["RunMicrovm", "CreateMicrovmAuthToken"])(
  "a message-based retry strategy for a throttled %s",
  (call) => {
    it("matches an anchored pattern against the original message, and retries up to maxAttempts", async () => {
      const client = new FakeMicrovmsClient();
      setup(client, call, throttled(true));
      const { strategy, seen } = recording(
        createRetryStrategy({ retryableErrors: [/^Rate exceeded$/] }),
      );

      const { runner, caught } = await runAndReplay(client, strategy);

      // createRetryStrategy allows 3 attempts by default.
      expect(callCount(client, call)).toBe(3);
      expect(seen).toEqual(["Rate exceeded", "Rate exceeded", "Rate exceeded"]);
      expectReported(
        runner,
        caught,
        call,
        `Rate exceeded. ${call} request ID: req-3.`,
      );
    });

    it("does not match a loose pattern against the request ID sentence", async () => {
      const client = new FakeMicrovmsClient();
      setup(client, call, throttled(true));
      const { strategy, seen } = recording(
        createRetryStrategy({ retryableErrors: [/request/i] }),
      );

      const { runner, caught } = await runAndReplay(client, strategy);

      expect(callCount(client, call)).toBe(1);
      expect(seen).toEqual(["Rate exceeded"]);
      expectReported(
        runner,
        caught,
        call,
        `Rate exceeded. ${call} request ID: req-1.`,
      );
    });

    it("leaves the message of an error without a request ID unchanged", async () => {
      const client = new FakeMicrovmsClient();
      const thrown: Error[] = [];
      setup(client, call, throttled(false, thrown));
      const { strategy, seen } = recording(
        createRetryStrategy({ retryableErrors: [/^Rate exceeded$/] }),
      );

      const { runner, caught } = await runAndReplay(client, strategy);

      expect(callCount(client, call)).toBe(3);
      expect(seen).toEqual(["Rate exceeded", "Rate exceeded", "Rate exceeded"]);
      expect(thrown.map((error) => error.message)).toEqual([
        "Rate exceeded",
        "Rate exceeded",
        "Rate exceeded",
      ]);
      expectReported(runner, caught, call, "Rate exceeded");
    });

    it("shows a strategy that reads error.message the original message, and keeps the request ID on the error after it returns", async () => {
      const client = new FakeMicrovmsClient();
      const thrown: Error[] = [];
      setup(client, call, throttled(true, thrown));
      const after: string[] = [];
      const retryStrategy: RetryStrategy = (error, attemptCount) => {
        after.push(error.message);
        return {
          shouldRetry: error.message === "Rate exceeded" && attemptCount < 2,
          delay: { seconds: 1 },
        };
      };

      const { runner, caught } = await runAndReplay(client, retryStrategy);

      expect(callCount(client, call)).toBe(2);
      expect(after).toEqual(["Rate exceeded", "Rate exceeded"]);
      // Each error object has the message with its request ID again.
      expect(thrown.map((error) => error.message)).toEqual([
        `Rate exceeded. ${call} request ID: req-1.`,
        `Rate exceeded. ${call} request ID: req-2.`,
      ]);
      expectReported(
        runner,
        caught,
        call,
        `Rate exceeded. ${call} request ID: req-2.`,
      );
    });

    it("keeps the request ID on the error when the strategy throws", async () => {
      const client = new FakeMicrovmsClient();
      const thrown: Error[] = [];
      setup(client, call, throttled(true, thrown));
      const seen: string[] = [];
      const failure = new Error("strategy failed");
      const retryStrategy: RetryStrategy = (error) => {
        seen.push(error.message);
        throw failure;
      };

      const { caught } = await runAndReplay(client, retryStrategy, 1);

      expect(callCount(client, call)).toBe(1);
      expect(seen).toEqual(["Rate exceeded"]);
      expect(thrown.map((error) => error.message)).toEqual([
        `Rate exceeded. ${call} request ID: req-1.`,
      ]);
      // The step rejects with the strategy's own error.
      for (const error of caught) {
        expect(error).toBeInstanceOf(errorClass[call]);
        expect((error as Error).message).toBe(`${prefix[call]}strategy failed`);
      }
    });
  },
);

describe("a message-based retry strategy for an error of another service", () => {
  it("sees the message of an STS error unchanged", async () => {
    const client = new FakeMicrovmsClient();
    client.runResponses = Array.from({ length: 5 }, () => async () => {
      throw new FakeStsServiceException("Rate exceeded", {
        httpStatusCode: 400,
        requestId: "sts-req-1",
      });
    });
    const { strategy, seen } = recording(
      createRetryStrategy({ retryableErrors: [/^Rate exceeded$/] }),
    );

    const { runner } = await runAndReplay(client, strategy);

    expect(client.runInputs).toHaveLength(3);
    expect(seen).toEqual(["Rate exceeded", "Rate exceeded", "Rate exceeded"]);
    expect(
      runner.getOperation("job.launch").getStepDetails()?.error,
    ).toMatchObject({ errorMessage: "Rate exceeded" });
  });
});

describe("a message-based retry strategy for a throttled GetMicrovm in a session", () => {
  // A session with `autoSuspendOnIdle: true` calls GetMicrovm in the request
  // step of each job. The session passes its scope to the job. So the
  // request step calls the strategy with the original message too.

  /**
   * Runs one job in a session, catches its error, and replays the failure
   * once. The second entry of `caught` is the replay.
   */
  async function runSession(
    client: FakeMicrovmsClient,
    retryStrategy: RetryStrategy,
  ): Promise<{ runner: LocalDurableTestRunner<unknown>; caught: unknown[] }> {
    const caught: unknown[] = [];
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) => {
          try {
            await microvmSession(
              context,
              "pipeline",
              {
                ...baseConfig(client),
                fetch: new FakeEndpoint().fetch,
                retryStrategy,
                timeout: { hours: 1 },
                autoSuspendOnIdle: true,
              },
              (vm, ctx) =>
                vm.invoke(ctx, "job", 1, {
                  path: "/job",
                  timeout: { minutes: 10 },
                }),
            );
            return "unexpected";
          } catch (error) {
            caught.push(error);
          }
          const [resumed] = await context.createCallback("go");
          await resumed;
          return "caught";
        },
      ),
    }) as LocalDurableTestRunner<unknown>;

    const executionPromise = runner.run({ payload: {} });
    const go = runner.getOperation("go");
    await go.waitForData(WaitingOperationStatus.STARTED);
    await go.sendCallbackSuccess(JSON.stringify("go"));
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toBe("caught");
    expect(caught.length).toBeGreaterThanOrEqual(2);
    return { runner, caught };
  }

  function expectSessionReported(
    runner: LocalDurableTestRunner<unknown>,
    caught: unknown[],
    stepMessage: string,
  ): void {
    for (const error of caught) {
      expect(error).toBeInstanceOf(MicrovmDeliveryError);
      expect((error as Error).message).toBe(
        `MicroVM "job": the job could not be delivered: ${stepMessage}`,
      );
    }
    expect(
      runner.getOperation("job.request").getStepDetails()?.error,
    ).toMatchObject({
      errorType: "ThrottlingException",
      errorMessage: stepMessage,
    });
  }

  it("matches an anchored pattern against the original message, and retries up to maxAttempts", async () => {
    const client = new FakeMicrovmsClient();
    const thrown: Error[] = [];
    client.getResponses = throttled(true, thrown);
    const { strategy, seen } = recording(
      createRetryStrategy({ retryableErrors: [/^Rate exceeded$/] }),
    );

    const { runner, caught } = await runSession(client, strategy);

    // createRetryStrategy allows 3 attempts by default. A thrown GetMicrovm
    // records no event. So the test counts the error objects.
    expect(thrown).toHaveLength(3);
    expect(seen).toEqual(["Rate exceeded", "Rate exceeded", "Rate exceeded"]);
    expectSessionReported(
      runner,
      caught,
      "Rate exceeded. GetMicrovm request ID: req-3.",
    );
  });

  it("does not match a loose pattern against the request ID sentence", async () => {
    const client = new FakeMicrovmsClient();
    const thrown: Error[] = [];
    client.getResponses = throttled(true, thrown);
    const { strategy, seen } = recording(
      createRetryStrategy({ retryableErrors: [/request/i] }),
    );

    const { runner, caught } = await runSession(client, strategy);

    // A thrown GetMicrovm records no event. So the test counts the error
    // objects.
    expect(thrown).toHaveLength(1);
    expect(seen).toEqual(["Rate exceeded"]);
    expectSessionReported(
      runner,
      caught,
      "Rate exceeded. GetMicrovm request ID: req-1.",
    );
  });
});

describe("a message-based retry strategy for a throttled TerminateMicrovm", () => {
  /** Runs one `microvm` job whose TerminateMicrovm calls fail. */
  async function runTerminate(
    client: FakeMicrovmsClient,
    retryStrategy: RetryStrategy,
  ): Promise<LocalDurableTestRunner<unknown>> {
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) =>
          microvm(context, "build", 1, {
            ...baseConfig(client),
            retryStrategy,
          }),
      ),
    }) as LocalDurableTestRunner<unknown>;

    const executionPromise = runner.run({ payload: {} });
    const callback = runner.getOperation("build.callback");
    await callback.waitForData(WaitingOperationStatus.STARTED);
    await callback.sendCallbackSuccess(JSON.stringify("ok"));
    const execution = await executionPromise;

    // A failed TerminateMicrovm call does not fail the operation.
    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toBe("ok");
    return runner;
  }

  it("matches the original message, and the terminate record keeps the request ID of the last call", async () => {
    const client = new FakeMicrovmsClient();
    client.terminateResponses = throttled(true);
    const { strategy, seen } = recording(
      createRetryStrategy({ retryableErrors: [/^Rate exceeded$/] }),
    );

    const runner = await runTerminate(client, strategy);

    expect(client.terminateInputs).toHaveLength(3);
    expect(seen).toEqual(["Rate exceeded", "Rate exceeded", "Rate exceeded"]);
    expect(
      runner.getOperation("build.terminate").getStepDetails()?.error,
    ).toMatchObject({
      errorType: "ThrottlingException",
      errorMessage: "Rate exceeded. TerminateMicrovm request ID: req-3.",
    });
  });

  it("does not match a loose pattern against the request ID sentence", async () => {
    const client = new FakeMicrovmsClient();
    client.terminateResponses = throttled(true);
    const { strategy, seen } = recording(
      createRetryStrategy({ retryableErrors: [/request/i] }),
    );

    const runner = await runTerminate(client, strategy);

    expect(client.terminateInputs).toHaveLength(1);
    expect(seen).toEqual(["Rate exceeded"]);
    expect(
      runner.getOperation("build.terminate").getStepDetails()?.error,
    ).toMatchObject({
      errorType: "ThrottlingException",
      errorMessage: "Rate exceeded. TerminateMicrovm request ID: req-1.",
    });
  });
});

describe("the retry strategy of an operation scope", () => {
  const context = {
    executionContext: {
      durableExecutionArn:
        "arn:aws:lambda:us-east-1:123456789012:function:f:1/durable-execution/e/i",
    },
  } as unknown as DurableContext;
  const changed = (): ThrottlingException =>
    addRequestId(
      "RunMicrovm",
      new ThrottlingException({
        message: "Rate exceeded",
        $metadata: { requestId: "req-1" },
      }),
    );
  const written = "Rate exceeded. RunMicrovm request ID: req-1.";

  it("passes on the error, the attempt count, this, and the return value of the caller's strategy", () => {
    const error = changed();
    const decision = { shouldRetry: true, delay: { seconds: 3 } };
    const calls: unknown[][] = [];
    const retryStrategy = jest.fn(function (
      this: unknown,
      e: Error,
      attemptCount: number,
    ) {
      calls.push([this, e, e.message, attemptCount]);
      return decision;
    });
    const scope = createScope(context, "job", {
      ...baseConfig(new FakeMicrovmsClient()),
      retryStrategy,
    });
    const options = { retryStrategy: scope.retryStrategy };

    expect(options.retryStrategy(error, 4)).toBe(decision);

    expect(calls).toEqual([[options, error, "Rate exceeded", 4]]);
    expect(error.message).toBe(written);
  });

  it("rethrows the exception of the caller's strategy", () => {
    const error = changed();
    const failure = new Error("strategy failed");
    const scope = createScope(context, "job", {
      ...baseConfig(new FakeMicrovmsClient()),
      retryStrategy: () => {
        throw failure;
      },
    });

    expect(() => scope.retryStrategy(error, 1)).toThrow(failure);
    expect(error.message).toBe(written);
  });

  it.each<[string, () => Error]>([
    ["a throttled call", changed],
    [
      "an access-denied call",
      () =>
        addRequestId(
          "GetMicrovm",
          new AccessDeniedException({
            message: "denied",
            $metadata: { requestId: "req-1" },
          }),
        ),
    ],
  ])(
    "decides as defaultMicrovmRetryStrategy for %s without a caller's strategy",
    (_label, make) => {
      const scope = createScope(
        context,
        "job",
        baseConfig(new FakeMicrovmsClient()),
      );
      for (let attempt = 1; attempt <= 5; attempt++) {
        const error = make();
        expect(scope.retryStrategy(error, attempt)).toEqual(
          defaultMicrovmRetryStrategy(error, attempt),
        );
      }
    },
  );
});
