import { createTestDurableContext } from "../../testing/create-test-durable-context";
import { DurableExecutionMode } from "../../types";
import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";
import { runWithContext } from "../../utils/context-tracker/context-tracker";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

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

  describe("getDurableLoggingContext", () => {
    describe("getDurableLogData function", () => {
      it("should return basic execution data in root context", () => {
        const { context, executionContext } = createTestDurableContext({
          durableExecutionMode: DurableExecutionMode.ExecutionMode,
        });

        const loggingContext = context.getDurableLoggingContext();

        runWithContext(
          "root",
          undefined,
          () => {
            const logData = loggingContext.getDurableLogData();

            expect(logData).toEqual({
              executionArn: executionContext.durableExecutionArn,
              requestId: executionContext.requestId,
              tenantId: executionContext.tenantId,
              operationId: undefined, // root context has no operationId
            });
          },
          undefined,
          DurableExecutionMode.ExecutionMode,
        );
      });

      it("should include operationId in child context", () => {
        const { context, executionContext } = createTestDurableContext({
          durableExecutionMode: DurableExecutionMode.ExecutionMode,
        });

        const loggingContext = context.getDurableLoggingContext();

        runWithContext(
          "1", // Child context ID
          undefined,
          () => {
            const logData = loggingContext.getDurableLogData();

            expect(logData).toEqual({
              executionArn: executionContext.durableExecutionArn,
              requestId: executionContext.requestId,
              tenantId: executionContext.tenantId,
              operationId: hashId("1"),
            });
          },
          undefined,
          DurableExecutionMode.ExecutionMode,
        );
      });

      it("should include attempt number when provided in active context", () => {
        const { context, executionContext } = createTestDurableContext({
          durableExecutionMode: DurableExecutionMode.ExecutionMode,
        });

        const loggingContext = context.getDurableLoggingContext();

        runWithContext(
          "1",
          undefined,
          () => {
            const logData = loggingContext.getDurableLogData();

            expect(logData).toEqual({
              executionArn: executionContext.durableExecutionArn,
              requestId: executionContext.requestId,
              tenantId: executionContext.tenantId,
              operationId: hashId("1"),
              attempt: 3,
            });
          },
          3, // attempt number
          DurableExecutionMode.ExecutionMode,
        );
      });

      it("should work without active context", () => {
        const { context, executionContext } = createTestDurableContext({
          durableExecutionMode: DurableExecutionMode.ExecutionMode,
        });

        const loggingContext = context.getDurableLoggingContext();

        // Call without runWithContext
        const logData = loggingContext.getDurableLogData();

        expect(logData).toEqual({
          executionArn: executionContext.durableExecutionArn,
          requestId: executionContext.requestId,
          tenantId: executionContext.tenantId,
          operationId: undefined,
        });
      });

      it("should handle nested child contexts correctly", () => {
        const { context, executionContext } = createTestDurableContext({
          durableExecutionMode: DurableExecutionMode.ExecutionMode,
        });

        const loggingContext = context.getDurableLoggingContext();

        // Simulate nested child context with ID "1-2-3"
        runWithContext(
          "1-2-3",
          "1-2",
          () => {
            const logData = loggingContext.getDurableLogData();

            expect(logData).toEqual({
              executionArn: executionContext.durableExecutionArn,
              requestId: executionContext.requestId,
              tenantId: executionContext.tenantId,
              operationId: hashId("1-2-3"),
            });
          },
          undefined,
          DurableExecutionMode.ExecutionMode,
        );
      });
    });
  });
});
