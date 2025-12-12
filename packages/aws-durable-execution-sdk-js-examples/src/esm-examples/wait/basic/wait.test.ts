import {
  OperationType,
  OperationStatus,
  LocalDurableTestRunner,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./wait";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({
    skipTime: true,
  }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("wait", () => {
  it("should call wait for 2 seconds with comprehensive verification", async () => {
    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
    });

    const execution = await runner.run();

    // Get operation using runner helper
    const waitOperation = runner.getOperationByIndex(0);

    // Verify final result
    expect(execution.getResult()).toBe("Function Completed");

    // Verify operations were tracked
    const completedOperations = execution.getOperations();
    expect(completedOperations.length).toEqual(1);

    // Verify operation data can be accessed
    expect(waitOperation.getType()).toBe(OperationType.WAIT);
    expect(waitOperation.getStatus()).toBe(OperationStatus.SUCCEEDED);
    expect(waitOperation.getWaitDetails()?.waitSeconds).toBe(2);
    expect(
      waitOperation.getWaitDetails()?.scheduledEndTimestamp,
    ).toBeInstanceOf(Date);
  });
});
