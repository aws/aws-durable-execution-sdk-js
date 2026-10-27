import { createTestDurableContext } from "../../testing/create-test-durable-context";
import { DurableExecutionMode } from "../../types";
import { OperationStatus, OperationType } from "../../types/wire";
import {
  runWithContext,
  runWithRootContext,
} from "../../utils/context-tracker/context-tracker";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

describe("DurableContext Composed Tests", () => {
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

      it("should include operationName when provided in active context", () => {
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
              operationName: "fetch-user",
              attempt: 2,
            });
          },
          2, // attempt number
          DurableExecutionMode.ExecutionMode,
          "fetch-user", // operation name
        );
      });

      it("should not include operationName in root context", () => {
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
              operationId: undefined,
            });
            expect(logData.operationName).toBeUndefined();
          },
          undefined,
          DurableExecutionMode.ExecutionMode,
          "root-op", // operation name should be ignored for root
        );
      });

      it("should use the execution identity of the active context, not of the context that created the logging context", () => {
        const { context, executionContext } = createTestDurableContext({
          durableExecutionMode: DurableExecutionMode.ExecutionMode,
        });
        const otherExecution = {
          executionArn: `${executionContext.durableExecutionArn}-other`,
          requestId: "other-request",
          tenantId: "other-tenant",
        };

        const loggingContext = context.getDurableLoggingContext();

        runWithRootContext(otherExecution, () =>
          runWithContext("1", "root", () => {
            expect(loggingContext.getDurableLogData()).toEqual({
              executionArn: otherExecution.executionArn,
              requestId: otherExecution.requestId,
              tenantId: otherExecution.tenantId,
              operationId: hashId("1"),
            });
          }),
        );
      });

      it("should use the context's own execution identity when the active context records none", () => {
        const { context, executionContext } = createTestDurableContext({
          durableExecutionMode: DurableExecutionMode.ExecutionMode,
        });

        const loggingContext = context.getDurableLoggingContext();

        runWithContext("1", undefined, () => {
          expect(loggingContext.getDurableLogData()).toEqual({
            executionArn: executionContext.durableExecutionArn,
            requestId: executionContext.requestId,
            tenantId: executionContext.tenantId,
            operationId: hashId("1"),
          });
        });
      });

      it("should return the plugin log fields", () => {
        const { context } = createTestDurableContext({
          plugin: { enrichLogContext: () => ({ traceId: "trace-1" }) },
        });

        expect(context.getDurableLoggingContext().getLogEnrichment?.()).toEqual(
          { traceId: "trace-1" },
        );
      });

      it("should read the plugin log fields on every call", () => {
        let spanId = "span-1";
        const { context } = createTestDurableContext({
          plugin: { enrichLogContext: () => ({ spanId }) },
        });
        const loggingContext = context.getDurableLoggingContext();

        expect(loggingContext.getLogEnrichment?.()).toEqual({
          spanId: "span-1",
        });
        spanId = "span-2";
        expect(loggingContext.getLogEnrichment?.()).toEqual({
          spanId: "span-2",
        });
      });

      it("should return undefined when a plugin throws", () => {
        const { context } = createTestDurableContext({
          plugin: {
            enrichLogContext: () => {
              throw new Error("plugin failed");
            },
          },
        });

        expect(
          context.getDurableLoggingContext().getLogEnrichment?.(),
        ).toBeUndefined();
      });

      it("should return undefined when no plugin adds fields", () => {
        const { context } = createTestDurableContext();

        expect(
          context.getDurableLoggingContext().getLogEnrichment?.(),
        ).toBeUndefined();
      });

      it("should use the plugins of the execution that the active context records", () => {
        const { context } = createTestDurableContext({
          plugin: { enrichLogContext: () => ({ traceId: "captured" }) },
        });
        const loggingContext = context.getDurableLoggingContext();

        runWithRootContext(
          {
            executionArn: "arn:other",
            requestId: "other-request",
            enrichLogContext: () => ({ traceId: "active" }),
          },
          () => {
            expect(loggingContext.getLogEnrichment?.()).toEqual({
              traceId: "active",
            });
          },
        );
      });

      it("should return undefined when the active execution has no plugin fields, even if this context's plugin has some", () => {
        const { context } = createTestDurableContext({
          plugin: { enrichLogContext: () => ({ traceId: "captured" }) },
        });
        const loggingContext = context.getDurableLoggingContext();

        runWithRootContext(
          { executionArn: "arn:other", requestId: "other-request" },
          () => {
            expect(loggingContext.getLogEnrichment?.()).toBeUndefined();
          },
        );
      });

      it("should return undefined when the active execution's plugin throws", () => {
        const { context } = createTestDurableContext();
        const loggingContext = context.getDurableLoggingContext();

        runWithRootContext(
          {
            executionArn: "arn:other",
            requestId: "other-request",
            enrichLogContext: () => {
              throw new Error("plugin failed");
            },
          },
          () => {
            expect(loggingContext.getLogEnrichment?.()).toBeUndefined();
          },
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
