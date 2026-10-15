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
  it("rejects without a fixed wait when the runner itself fails the execution", async () => {
    // A handler that throws produces a FAILED result, which resolves. The runner rejects
    // only when it reaches an invalid state. One such state is a PENDING response with
    // nothing left that could start another invocation.
    const handler: DurableLambdaHandler = async () => ({
      Status: InvocationStatus.PENDING,
    });

    const warn = jest.spyOn(defaultLogger, "warn");

    // The first run includes module loading and the worker's first request. Warm those up,
    // so the measured runs isolate the rejection path.
    await new LocalDurableTestRunner({ handlerFunction: handler })
      .run()
      .catch(() => undefined);

    const runs = 10;
    const start = performance.now();
    for (let i = 0; i < runs; i++) {
      await expect(
        new LocalDurableTestRunner({ handlerFunction: handler }).run(),
      ).rejects.toMatchObject({
        error: {
          ErrorMessage:
            "Cannot return PENDING status with no pending operations.",
        },
      });
    }
    const elapsedMs = performance.now() - start;

    // The old fixed wait alone made these runs take at least runs * 100 ms. The 50 ms
    // allowance per run leaves room for a slow machine while still detecting that wait.
    expect(elapsedMs).toBeLessThan(runs * 50);
    // Every drain succeeded, so none logged a warning.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
