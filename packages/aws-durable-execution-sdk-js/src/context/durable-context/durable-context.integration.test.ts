import { createTestDurableContext } from "../../testing/create-test-durable-context";
import { DurableExecutionMode } from "../../types";
import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";

describe("DurableContext Integration Tests", () => {
  it("should handle replay mode and skip operations correctly", async () => {
    // Create context in replay mode with existing operations
    const existingOperations = [
      {
        Id: "1",
        Type: OperationType.STEP,
        StartTimestamp: new Date(),
        Status: OperationStatus.SUCCEEDED,
      },
      {
        Id: "2",
        Type: OperationType.STEP,
        StartTimestamp: new Date(),
        Status: OperationStatus.SUCCEEDED,
      },
    ];

    const { context } = createTestDurableContext({
      durableExecutionMode: DurableExecutionMode.ReplayMode,
      existingOperations,
    });

    // Execute steps - they should replay from existing operations
    const result1 = await context.step("step-1", async () => "value1");
    const result2 = await context.step("step-2", async () => "value2");

    // In replay mode, steps should execute
    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
  });

  it("should transition from replay to execution mode", async () => {
    // Create context with only one existing operation
    const existingOperations = [
      {
        Id: "1",
        Type: OperationType.STEP,
        StartTimestamp: new Date(),
        Status: OperationStatus.SUCCEEDED,
      },
    ];

    const { context } = createTestDurableContext({
      durableExecutionMode: DurableExecutionMode.ReplayMode,
      existingOperations,
    });

    // First step replays
    const result1 = await context.step("step-1", async () => "value1");

    // Second step should transition to execution mode (no existing operation)
    const result2 = await context.step("step-2", async () => "value2");

    expect(result1).toBeDefined();
    expect(result2).toBe("value2");
  });
});
