import {
  OperationType,
  OperationStatus,
  LocalDurableTestRunner,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./step-basic";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("step-basic", () => {
  it("should execute step and return correct result with detailed verification", async () => {
    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
    });

    const execution = await runner.run();

    // Get step operation
    const stepOperation = runner.getOperationByIndex(0);

    expect(execution.getOperations()).toHaveLength(1);
    expect(execution.getResult()).toStrictEqual("step completed");

    // Verify operation details
    expect(stepOperation.getType()).toBe(OperationType.STEP);
    expect(stepOperation.getStatus()).toBe(OperationStatus.SUCCEEDED);
    expect(stepOperation.getStepDetails()).toBeDefined();
    expect(stepOperation.getStepDetails()?.result).toEqual("step completed");
  });
});
