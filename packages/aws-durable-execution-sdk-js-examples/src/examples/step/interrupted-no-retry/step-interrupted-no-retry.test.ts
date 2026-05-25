import {
  LocalDurableTestRunner,
  OperationType,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./step-interrupted-no-retry";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("Step Interrupted No Retry", () => {
  const durableTestRunner = new LocalDurableTestRunner({
    handlerFunction: handler,
  });

  it("should handle interrupted step with shouldRetry:false without crashing", async () => {
    // Set up the test runner with interrupted step history
    const testRunnerWithHistory = new LocalDurableTestRunner({
      handlerFunction: handler,
      historyEvents: [
        {
          Id: "1",
          Type: OperationType.STEP,
          SubType: "STEP",
          Status: OperationStatus.STARTED,
          Name: "InterruptedStep",
          StepDetails: {
            Attempt: 0,
          },
        },
      ],
    });

    const execution = await testRunnerWithHistory.run();

    // Should not crash and should return error response
    expect(execution.getError()).toBeDefined();
    expect(execution.getError()?.errorType).toBe("DurableOperationError");
    expect(execution.getError()?.errorMessage).toContain("interruption");
  });

  it("should complete successfully on first run without interruption", async () => {
    // Mock setTimeout to resolve immediately for testing
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = ((callback: () => void) => {
      callback();
      return 1 as any;
    }) as any;

    try {
      const execution = await durableTestRunner.run();

      expect(execution.getResult()).toEqual({
        success: true,
        result: "This should not complete",
      });
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });
});
