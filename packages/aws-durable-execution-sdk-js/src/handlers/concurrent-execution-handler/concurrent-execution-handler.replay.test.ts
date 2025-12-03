import { ConcurrencyController } from "./concurrent-execution-handler";
import {
  DurableLogger,
  DurableContext,
  DurableExecutionMode,
  ExecutionContext,
  DurablePromise,
} from "../../types";
import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";

describe("ConcurrencyController - Replay Mode", () => {
  let controller: ConcurrencyController<DurableLogger>;
  let mockParentContext: jest.Mocked<DurableContext<DurableLogger>>;
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let mockSkipNextOperation: jest.Mock;

  beforeEach(() => {
    mockSkipNextOperation = jest.fn();
    controller = new ConcurrencyController(
      "test-operation",
      mockSkipNextOperation,
    );
    mockParentContext = {
      runInChildContext: jest.fn(),
    } as any;
    mockExecutionContext = {
      getStepData: jest.fn(),
    } as any;
  });

  it("should replay only completed items in ReplaySucceededContext mode", async () => {
    const items = [
      { id: "item-0", data: "data1", index: 0 },
      { id: "item-1", data: "data2", index: 1 },
      { id: "item-2", data: "data3", index: 2 },
    ];
    const executor = jest.fn();
    const entityId = "parent-step";

    const initialResultSummary = JSON.stringify({
      type: "MapResult",
      totalCount: 2,
      successCount: 2,
      failureCount: 0,
      completionReason: "ALL_COMPLETED",
      status: "SUCCEEDED",
    });

    mockExecutionContext.getStepData.mockImplementation((id: string) => {
      if (id === entityId) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          ContextDetails: { Result: initialResultSummary },
        };
      }
      if (id === `${entityId}-1` || id === `${entityId}-2`) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
        };
      }
      return undefined;
    });

    mockParentContext.runInChildContext.mockImplementation(
      (nameOrFn, fnOrConfig) => {
        const fn = typeof nameOrFn === "function" ? nameOrFn : fnOrConfig;
        return new DurablePromise(async () => {
          return await (fn as any)({} as any);
        });
      },
    );

    executor.mockResolvedValueOnce("result1").mockResolvedValueOnce("result2");

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      {},
      DurableExecutionMode.ReplaySucceededContext,
      entityId,
      mockExecutionContext,
    );

    expect(result.successCount).toBe(2);
    expect(result.totalCount).toBe(2);
    expect(mockParentContext.runInChildContext).toHaveBeenCalledTimes(2);
  });

  it("should handle failed items during replay", async () => {
    const items = [
      { id: "item-0", data: "data1", index: 0 },
      { id: "item-1", data: "data2", index: 1 },
    ];
    const executor = jest.fn();
    const entityId = "parent-step";

    const initialResultSummary = JSON.stringify({
      type: "MapResult",
      totalCount: 2,
      successCount: 1,
      failureCount: 1,
      completionReason: "ALL_COMPLETED",
      status: "FAILED",
    });

    mockExecutionContext.getStepData.mockImplementation((id: string) => {
      if (id === entityId) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          ContextDetails: { Result: initialResultSummary },
        };
      }
      if (id === `${entityId}-1`) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
        };
      }
      if (id === `${entityId}-2`) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.FAILED,
        };
      }
      return undefined;
    });

    mockParentContext.runInChildContext.mockImplementation(
      (nameOrFn, fnOrConfig) => {
        const name = typeof nameOrFn === "string" ? nameOrFn : undefined;
        const fn = typeof nameOrFn === "function" ? nameOrFn : fnOrConfig;
        return new DurablePromise(async () => {
          if (name === "item-1") {
            throw new Error("Replay error");
          }
          return await (fn as any)({} as any);
        });
      },
    );

    executor.mockResolvedValueOnce("result1");

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      {},
      DurableExecutionMode.ReplaySucceededContext,
      entityId,
      mockExecutionContext,
    );

    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);
    expect(result.totalCount).toBe(2);
  });

  it("should stop replay early when target count is reached", async () => {
    const items = [
      { id: "item-0", data: "data1", index: 0 },
      { id: "item-1", data: "data2", index: 1 },
      { id: "item-2", data: "data3", index: 2 },
      { id: "item-3", data: "data4", index: 3 },
    ];
    const executor = jest.fn();
    const entityId = "parent-step";

    const initialResultSummary = JSON.stringify({
      type: "MapResult",
      totalCount: 2,
      successCount: 2,
      failureCount: 0,
      completionReason: "ALL_COMPLETED",
      status: "SUCCEEDED",
    });

    mockExecutionContext.getStepData.mockImplementation((id: string) => {
      if (id === entityId) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          ContextDetails: { Result: initialResultSummary },
        };
      }
      if (id === `${entityId}-1` || id === `${entityId}-2`) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
        };
      }
      return undefined;
    });

    mockParentContext.runInChildContext.mockResolvedValue("result");
    executor.mockResolvedValue("result");

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      {},
      DurableExecutionMode.ReplaySucceededContext,
      entityId,
      mockExecutionContext,
    );

    expect(result.totalCount).toBe(2);
    expect(mockParentContext.runInChildContext).toHaveBeenCalledTimes(2);
  });

  it("should skip incomplete items during replay", async () => {
    const items = [
      { id: "item-0", data: "data1", index: 0 },
      { id: "item-1", data: "data2", index: 1 },
      { id: "item-2", data: "data3", index: 2 },
    ];
    const executor = jest.fn();
    const entityId = "parent-step";

    // Items 0 and 2 completed, item 1 was incomplete
    const initialResultSummary = JSON.stringify({
      type: "MapResult",
      totalCount: 2,
      successCount: 2,
      failureCount: 0,
      completionReason: "ALL_COMPLETED",
      status: "SUCCEEDED",
    });

    mockExecutionContext.getStepData.mockImplementation((id: string) => {
      if (id === entityId) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          ContextDetails: { Result: initialResultSummary },
        };
      }
      if (id === `${entityId}-1`) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
        };
      }
      // Item 1 incomplete (entityId-2)
      if (id === `${entityId}-2`) {
        return undefined;
      }
      // Item 2 completed (entityId-3)
      if (id === `${entityId}-3`) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
        };
      }
      return undefined;
    });

    mockParentContext.runInChildContext.mockResolvedValue("result");
    executor.mockResolvedValue("result");

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      {},
      DurableExecutionMode.ReplaySucceededContext,
      entityId,
      mockExecutionContext,
    );

    expect(result.totalCount).toBe(2);
    expect(mockParentContext.runInChildContext).toHaveBeenCalledTimes(2);
    expect(mockSkipNextOperation).toHaveBeenCalledTimes(1);
  });

  it("should fallback to concurrent execution when no target count found", async () => {
    const items = [{ id: "item-0", data: "data1", index: 0 }];
    const executor = jest.fn().mockResolvedValue("result");

    mockExecutionContext.getStepData.mockReturnValue(undefined);
    mockParentContext.runInChildContext.mockResolvedValue("result");

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      {},
      DurableExecutionMode.ReplaySucceededContext,
      "parent-step",
      mockExecutionContext,
    );

    expect(result.successCount).toBe(1);
  });

  it("should fallback to concurrent execution when summary parsing fails", async () => {
    const items = [{ id: "item-0", data: "data1", index: 0 }];
    const executor = jest.fn().mockResolvedValue("result");
    const entityId = "parent-step";

    mockExecutionContext.getStepData.mockReturnValue({
      Id: entityId,
      Type: OperationType.CONTEXT,
      StartTimestamp: new Date(),
      Status: OperationStatus.SUCCEEDED,
      ContextDetails: { Result: "invalid json" },
    });
    mockParentContext.runInChildContext.mockResolvedValue("result");

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      {},
      DurableExecutionMode.ReplaySucceededContext,
      entityId,
      mockExecutionContext,
    );

    expect(result.successCount).toBe(1);
  });

  it("should use ExecutionMode for first-time execution", async () => {
    const items = [
      { id: "item-0", data: "data1", index: 0 },
      { id: "item-1", data: "data2", index: 1 },
    ];
    const executor = jest.fn().mockResolvedValue("result");

    mockParentContext.runInChildContext.mockResolvedValue("result");

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      {},
      DurableExecutionMode.ExecutionMode,
    );

    expect(result.successCount).toBe(2);
    expect(mockParentContext.runInChildContext).toHaveBeenCalledTimes(2);
  });

  it("should handle non-Error thrown values during replay", async () => {
    const items = [{ id: "item-0", data: "data1", index: 0 }];
    const executor = jest.fn();
    const entityId = "parent-step";

    const initialResultSummary = JSON.stringify({
      type: "MapResult",
      totalCount: 1,
      successCount: 0,
      failureCount: 1,
      completionReason: "ALL_COMPLETED",
      status: "FAILED",
    });

    mockExecutionContext.getStepData.mockImplementation((id: string) => {
      if (id === entityId) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          ContextDetails: { Result: initialResultSummary },
        };
      }
      if (id === `${entityId}-1`) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.FAILED,
        };
      }
      return undefined;
    });

    mockParentContext.runInChildContext.mockRejectedValue("string error");

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      {},
      DurableExecutionMode.ReplaySucceededContext,
      entityId,
      mockExecutionContext,
    );

    expect(result.failureCount).toBe(1);
    expect(result.failed()[0].error).toBeInstanceOf(Error);
    expect(result.failed()[0].error?.message).toBe("string error");
  });

  it("should reconstruct MIN_SUCCESSFUL_REACHED completion reason in replay", async () => {
    const items = [
      { id: "item-0", data: "data1", index: 0 },
      { id: "item-1", data: "data2", index: 1 },
      { id: "item-2", data: "data3", index: 2 },
    ];
    const executor = jest.fn();
    const entityId = "parent-step";

    const initialResultSummary = JSON.stringify({
      type: "MapResult",
      totalCount: 2,
      successCount: 2,
      failureCount: 0,
      completionReason: "MIN_SUCCESSFUL_REACHED",
      status: "SUCCEEDED",
    });

    mockExecutionContext.getStepData.mockImplementation((id: string) => {
      if (id === entityId) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          ContextDetails: { Result: initialResultSummary },
        };
      }
      if (id === `${entityId}-1`) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          ContextDetails: { Result: "result1" },
        };
      }
      if (id === `${entityId}-2`) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          ContextDetails: { Result: "result2" },
        };
      }
      return undefined;
    });

    mockParentContext.runInChildContext
      .mockResolvedValueOnce("result1")
      .mockResolvedValueOnce("result2");

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      { completionConfig: { minSuccessful: 2 } },
      DurableExecutionMode.ReplaySucceededContext,
      entityId,
      mockExecutionContext,
    );

    expect(result.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
    expect(result.successCount).toBe(2);
    expect(result.totalCount).toBe(2);
  });

  it("should reconstruct FAILURE_TOLERANCE_EXCEEDED completion reason in replay with toleratedFailureCount", async () => {
    const items = [
      { id: "item-0", data: "data1", index: 0 },
      { id: "item-1", data: "data2", index: 1 },
      { id: "item-2", data: "data3", index: 2 },
    ];
    const executor = jest.fn();
    const entityId = "parent-step";

    const initialResultSummary = JSON.stringify({
      type: "MapResult",
      totalCount: 3,
      successCount: 1,
      failureCount: 2,
      completionReason: "FAILURE_TOLERANCE_EXCEEDED",
      status: "FAILED",
    });

    mockExecutionContext.getStepData.mockImplementation((id: string) => {
      if (id === entityId) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.FAILED,
          ContextDetails: { Result: initialResultSummary },
        };
      }
      if (id === `${entityId}-1`) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          ContextDetails: { Result: "result1" },
        };
      }
      if (id === `${entityId}-2`) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.FAILED,
        };
      }
      if (id === `${entityId}-3`) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.FAILED,
        };
      }
      return undefined;
    });

    mockParentContext.runInChildContext
      .mockResolvedValueOnce("result1")
      .mockRejectedValueOnce(new Error("error1"))
      .mockRejectedValueOnce(new Error("error2"));

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      { completionConfig: { toleratedFailureCount: 1 } },
      DurableExecutionMode.ReplaySucceededContext,
      entityId,
      mockExecutionContext,
    );

    expect(result.completionReason).toBe("FAILURE_TOLERANCE_EXCEEDED");
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(2);
    expect(result.totalCount).toBe(3);
  });

  it("should reconstruct FAILURE_TOLERANCE_EXCEEDED completion reason in replay with toleratedFailurePercentage", async () => {
    const items = [
      { id: "item-0", data: "data1", index: 0 },
      { id: "item-1", data: "data2", index: 1 },
      { id: "item-2", data: "data3", index: 2 },
    ];
    const executor = jest.fn();
    const entityId = "parent-step";

    const initialResultSummary = JSON.stringify({
      type: "MapResult",
      totalCount: 3,
      successCount: 1,
      failureCount: 2,
      completionReason: "FAILURE_TOLERANCE_EXCEEDED",
      status: "FAILED",
    });

    mockExecutionContext.getStepData.mockImplementation((id: string) => {
      if (id === entityId) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.FAILED,
          ContextDetails: { Result: initialResultSummary },
        };
      }
      if (id === `${entityId}-1`) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          ContextDetails: { Result: "result1" },
        };
      }
      if (id === `${entityId}-2`) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.FAILED,
        };
      }
      if (id === `${entityId}-3`) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.FAILED,
        };
      }
      return undefined;
    });

    mockParentContext.runInChildContext
      .mockResolvedValueOnce("result1")
      .mockRejectedValueOnce(new Error("error1"))
      .mockRejectedValueOnce(new Error("error2"));

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      { completionConfig: { toleratedFailurePercentage: 40 } },
      DurableExecutionMode.ReplaySucceededContext,
      entityId,
      mockExecutionContext,
    );

    expect(result.completionReason).toBe("FAILURE_TOLERANCE_EXCEEDED");
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(2);
    expect(result.totalCount).toBe(3);
    // 2 failures out of 3 items = 66.67% > 40% tolerance
  });

  it("should reconstruct FAILURE_TOLERANCE_EXCEEDED completion reason in replay with fail-fast (no completion config)", async () => {
    const items = [
      { id: "item-0", data: "data1", index: 0 },
      { id: "item-1", data: "data2", index: 1 },
    ];
    const executor = jest.fn();
    const entityId = "parent-step";

    const initialResultSummary = JSON.stringify({
      type: "MapResult",
      totalCount: 1,
      successCount: 0,
      failureCount: 1,
      completionReason: "FAILURE_TOLERANCE_EXCEEDED",
      status: "FAILED",
    });

    mockExecutionContext.getStepData.mockImplementation((id: string) => {
      if (id === entityId) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.FAILED,
          ContextDetails: { Result: initialResultSummary },
        };
      }
      if (id === `${entityId}-1`) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.FAILED,
        };
      }
      return undefined;
    });

    mockParentContext.runInChildContext.mockRejectedValueOnce(
      new Error("error1"),
    );

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      {}, // No completion config - should fail fast
      DurableExecutionMode.ReplaySucceededContext,
      entityId,
      mockExecutionContext,
    );

    expect(result.completionReason).toBe("FAILURE_TOLERANCE_EXCEEDED");
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(1);
    expect(result.totalCount).toBe(1);
  });

  it("should reconstruct FAILURE_TOLERANCE_EXCEEDED completion reason in replay with empty completion config", async () => {
    const items = [
      { id: "item-0", data: "data1", index: 0 },
      { id: "item-1", data: "data2", index: 1 },
    ];
    const executor = jest.fn();
    const entityId = "parent-step";

    const initialResultSummary = JSON.stringify({
      type: "MapResult",
      totalCount: 1,
      successCount: 0,
      failureCount: 1,
      completionReason: "FAILURE_TOLERANCE_EXCEEDED",
      status: "FAILED",
    });

    mockExecutionContext.getStepData.mockImplementation((id: string) => {
      if (id === entityId) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.FAILED,
          ContextDetails: { Result: initialResultSummary },
        };
      }
      if (id === `${entityId}-1`) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.FAILED,
        };
      }
      return undefined;
    });

    mockParentContext.runInChildContext.mockRejectedValueOnce(
      new Error("error1"),
    );

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      { completionConfig: {} }, // Empty completion config - should fail fast
      DurableExecutionMode.ReplaySucceededContext,
      entityId,
      mockExecutionContext,
    );

    expect(result.completionReason).toBe("FAILURE_TOLERANCE_EXCEEDED");
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(1);
    expect(result.totalCount).toBe(1);
  });
});
