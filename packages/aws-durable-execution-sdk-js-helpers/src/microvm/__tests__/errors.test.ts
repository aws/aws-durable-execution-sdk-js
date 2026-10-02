import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { ValidationException } from "@aws-sdk/client-lambda-microvms";
import {
  MicrovmDeliveryError,
  MicrovmError,
  MicrovmJobFailedError,
  MicrovmLaunchError,
  MicrovmTimeoutError,
  microvm,
  microvmSession,
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

type Runner = LocalDurableTestRunner<unknown>;

/** What a caller sees of the error. */
interface Seen {
  className: string;
  isMicrovmError: boolean;
  errorType: string;
  message: string;
  errorData?: string;
}

const MICROVM_CLASSES = [
  MicrovmLaunchError,
  MicrovmDeliveryError,
  MicrovmJobFailedError,
  MicrovmTimeoutError,
  MicrovmError,
];

async function see(run: () => Promise<unknown>): Promise<Seen> {
  try {
    await run();
  } catch (error) {
    const e = error as MicrovmError;
    return {
      className:
        MICROVM_CLASSES.find((Class) => e instanceof Class)?.name ??
        e.constructor.name,
      isMicrovmError: e instanceof MicrovmError,
      errorType: e.errorType,
      message: e.message,
      ...(e.errorData !== undefined && { errorData: e.errorData }),
    };
  }
  throw new Error("the operation did not fail");
}

/**
 * Runs an operation that fails. The handler records what it saw in a step,
 * then waits, so the next invocation replays the failed operation from its
 * checkpoint. It returns both views.
 */
function failingRunner(
  operation: (context: DurableContext) => Promise<unknown>,
): Runner {
  return new LocalDurableTestRunner({
    handlerFunction: withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        const seen = await see(() => operation(context));
        const firstRun = await context.step("record", async () => seen);
        await context.wait("replay", { seconds: 1 });
        return { firstRun, replay: seen };
      },
    ),
  }) as Runner;
}

async function bothViews(
  runner: Runner,
  drive: () => Promise<void> = async () => {},
): Promise<{ firstRun: Seen; replay: Seen }> {
  const executionPromise = runner.run({ payload: {} });
  await drive();
  const execution = await executionPromise;
  expect(execution.getStatus()).toBe("SUCCEEDED");
  const views = execution.getResult() as { firstRun: Seen; replay: Seen };
  // The class, type, and message are the same on the first run and on
  // replay. So code that branches on them stays deterministic.
  expect(views.replay).toEqual(views.firstRun);
  return views;
}

describe("MicroVM errors", () => {
  it("reports a rejected launch as MicrovmLaunchError", async () => {
    const client = new FakeMicrovmsClient();
    client.runResponses = [
      throwing(new ValidationException({ message: "bad image", ...metadata })),
    ];
    const runner = failingRunner((context) =>
      microvm(context, "build", {}, baseConfig(client)),
    );

    const { firstRun } = await bothViews(runner);

    expect(firstRun).toEqual({
      className: "MicrovmLaunchError",
      isMicrovmError: true,
      errorType: "MicrovmLaunchError",
      message: expect.stringMatching(
        /^MicroVM "build": the launch failed: .*bad image/,
      ),
    });
  });

  it("reports a route that rejects the job as MicrovmDeliveryError", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    endpoint.responses = [404];
    const runner = failingRunner((context) =>
      microvm(
        context,
        "build",
        {},
        {
          ...baseConfig(client),
          fetch: endpoint.fetch,
          request: { path: "/missing" },
        },
      ),
    );

    const { firstRun } = await bothViews(runner);

    expect(firstRun.className).toBe("MicrovmDeliveryError");
    expect(firstRun.errorType).toBe("MicrovmDeliveryError");
    expect(firstRun.message).toMatch(
      /^MicroVM "build": the job could not be delivered: .*HTTP 404/,
    );
    // The MicroVM was launched, so it is still terminated.
    expect(client.terminateInputs).toEqual([{ microvmIdentifier: "mvm-1" }]);
  });

  it("reports the job's failure as MicrovmJobFailedError with the job's type and data", async () => {
    const client = new FakeMicrovmsClient();
    const runner = failingRunner((context) =>
      microvm(context, "build", {}, baseConfig(client)),
    );

    const { firstRun } = await bothViews(runner, async () => {
      const callback = runner.getOperation("build.callback");
      await callback.waitForData(WaitingOperationStatus.STARTED);
      await callback.sendCallbackFailure({
        ErrorType: "BuildError",
        ErrorMessage: "3 tests failed",
        ErrorData: JSON.stringify({ failed: 3 }),
      });
    });

    expect(firstRun).toEqual({
      className: "MicrovmJobFailedError",
      isMicrovmError: true,
      errorType: "MicrovmJobFailedError",
      message: 'MicroVM "build": the job failed (BuildError): 3 tests failed',
      errorData: JSON.stringify({ failed: 3 }),
    });
  });

  it("reports a job without a result in time as MicrovmTimeoutError", async () => {
    const client = new FakeMicrovmsClient();
    const runner = failingRunner((context) =>
      microvm(
        context,
        "build",
        {},
        {
          ...baseConfig(client),
          timeout: { seconds: 2 },
        },
      ),
    );

    const { firstRun } = await bothViews(runner);

    expect(firstRun.className).toBe("MicrovmTimeoutError");
    expect(firstRun.errorType).toBe("MicrovmTimeoutError");
    expect(firstRun.message).toMatch(/^MicroVM "build": the job timed out: /);
  });

  it("reports a failed session job as MicrovmJobFailedError inside the handler and after it", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    let inHandler: Seen | undefined;
    const runner = failingRunner((context) =>
      microvmSession(
        context,
        "pipeline",
        { ...baseConfig(client), fetch: endpoint.fetch },
        async (vm) => {
          try {
            return await vm.invoke("build", {}, { timeout: { minutes: 5 } });
          } catch (error) {
            inHandler = await see(() => Promise.reject(error));
            // The handler lets the failure leave the session.
            throw error;
          }
        },
      ),
    );
    const { firstRun } = await bothViews(runner, async () => {
      const callback = runner.getOperation("build.callback");
      await callback.waitForData(WaitingOperationStatus.STARTED);
      await callback.sendCallbackFailure({
        ErrorType: "BuildError",
        ErrorMessage: "compile error",
      });
    });

    expect(inHandler?.className).toBe("MicrovmJobFailedError");
    expect(firstRun.className).toBe("MicrovmJobFailedError");
    expect(firstRun.message).toBe(
      'MicroVM "build": the job failed (BuildError): compile error',
    );
  });

  it("keeps an error of the session handler's own code out of the MicroVM errors", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const runner = failingRunner((context) =>
      microvmSession(
        context,
        "pipeline",
        { ...baseConfig(client), fetch: endpoint.fetch },
        async () => {
          throw new Error("handler gave up");
        },
      ),
    );

    const { firstRun } = await bothViews(runner);

    expect(firstRun.isMicrovmError).toBe(false);
    expect(firstRun.message).toContain("handler gave up");
  });

  it("reaches a caller outside another child context wrapped, with the MicroVM type in the cause chain", async () => {
    // The SDK wraps a failure that leaves a child context without an error
    // mapper in ChildContextError. It rebuilds the inner error type, which it
    // does not know, as StepError, and keeps the type as that error's
    // cause.name. So the class is restored only at the operation's own
    // boundary.
    const client = new FakeMicrovmsClient();
    client.runResponses = [
      throwing(new ValidationException({ message: "bad image", ...metadata })),
    ];
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) => {
          try {
            await context.runInChildContext("outer", (outer) =>
              microvm(outer, "build", {}, baseConfig(client)),
            );
          } catch (error) {
            const chain: string[] = [];
            let node: unknown = error;
            while (node instanceof Error) {
              chain.push(node.name);
              node = node.cause;
            }
            return { chain };
          }
          return "not failed";
        },
      ),
    });

    const execution = await runner.run({ payload: {} });

    expect(execution.getResult()).toEqual({
      chain: ["ChildContextError", "StepError", "MicrovmLaunchError"],
    });
  });
});
