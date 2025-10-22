import {
  LocalDurableTestRunner,
  OperationType,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "../run-in-child-context";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("run-in-child-context test", () => {
  const durableTestRunner = new LocalDurableTestRunner({
    handlerFunction: handler,
    skipTime: true,
  });

  it("should return correct result", async () => {
    const execution = await durableTestRunner.run();

    expect(execution.getResult()).toBe("child step completed");
  });

  it("parent should return result from child", async () => {
    const parentOp = durableTestRunner.getOperationByIndex(0);
    const childOp = durableTestRunner.getOperationByIndex(1);

    await durableTestRunner.run();

    expect(parentOp.getChildOperations()).toHaveLength(1);
    expect(parentOp.getContextDetails()?.result).toBe("child step completed");
  });

  it("should handle child context operations with comprehensive tracking", async () => {
    const execution = await durableTestRunner.run();

    const parentOp = durableTestRunner.getOperationByIndex(0);
    const childStepOp = durableTestRunner.getOperationByIndex(1);

    // Verify final result
    expect(execution.getResult()).toBe("child step completed");

    // Verify operations were tracked
    const operations = execution.getOperations();
    expect(operations.length).toEqual(2);

    // Verify parent context operation
    expect(parentOp.getType()).toBe(OperationType.CONTEXT);
    expect(parentOp.getStatus()).toBe(OperationStatus.SUCCEEDED);
    expect(parentOp.getContextDetails()?.result).toEqual(
      "child step completed",
    );

    // Verify child operations relationship
    const childOperations = parentOp.getChildOperations();
    expect(childOperations).toHaveLength(1);
    expect(childOperations![0].getStepDetails()?.result).toEqual(
      "child step completed",
    );
  });
});
