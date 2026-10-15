import {
  DurableLambdaHandler,
  InvocationStatus,
} from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "../../local-durable-test-runner";
import { defaultLogger } from "../../../../logger";

// Without skipTime. With skipTime, the queue scheduler counts the invocation that is ending
// as pending work, so the runner waits for an invocation that never starts.
beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

/**
 * The end of an execution that the runner rejects, through the real checkpoint worker.
 * The success path is covered in execution-completion.integration.test.ts.
 */
describe("execution completion when the runner rejects", () => {
  it("rejects after the fixed wait when the runner itself fails the execution", async () => {
    // A handler that throws produces a FAILED result, which resolves. The runner rejects
    // only when it reaches an invalid state. One such state is a PENDING response with
    // nothing left that could start another invocation.
    const handler: DurableLambdaHandler = async () => ({
      Status: InvocationStatus.PENDING,
    });

    // The first run includes module loading and the worker's first request. Warm those up,
    // so the measured run isolates the rejection path.
    await new LocalDurableTestRunner({ handlerFunction: handler })
      .run()
      .catch(() => undefined);

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const warn = jest.spyOn(defaultLogger, "warn");

    const start = performance.now();
    await expect(runner.run()).rejects.toMatchObject({
      error: {
        ErrorMessage:
          "Cannot return PENDING status with no pending operations.",
      },
    });
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeGreaterThanOrEqual(90);
    // The drain succeeded, so it logged nothing.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
