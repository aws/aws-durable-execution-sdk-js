import { ConcurrencyController } from "./concurrent-execution-handler";
import {
  DurableLogger,
  DurableContext,
  DurableExecutionMode,
  ExecutionContext,
  DurablePromise,
} from "../../types";
import { OperationStatus, OperationType } from "../../types/wire";
import { NestingType } from "../../types/batch";

describe("ConcurrencyController - Replay Mode", () => {
  let controller: ConcurrencyController<DurableLogger>;
  let mockParentContext: jest.Mocked<DurableContext<DurableLogger>>;
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let mockSkipNextOperation: jest.Mock;

  beforeEach(() => {
    // Summarized replay skips items it does not re-execute by advancing the
    // step cursor of the context runInChildContext runs on (parentContext).
    mockSkipNextOperation = jest.fn();
    controller = new ConcurrencyController("test-operation");
    mockParentContext = {
      runInChildContext: jest.fn(),
      skipNextOperation: mockSkipNextOperation,
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

  it("does not rebuild a virtual item that was mid-flight, when only its first operation succeeded", async () => {
    // Regression cover for terminality-by-first-operation being unsound.
    //
    // A FLAT (virtual) item has no context checkpoint, so its own operations
    // have to be consulted. An item still in flight at suspension can have a
    // SUCCEEDED first operation and an unfinished second one. Treating the
    // first operation as the signal would classify it finished and re-drive it:
    // its unfinished operations would execute for real (duplicating side
    // effects) and the rebuilt batch would contain an item the live run never
    // completed -- the divergence this replay path exists to avoid.
    //
    // No per-item statuses are recorded here, so this exercises the probe used
    // for summaries written before that field existed.
    const items = [
      { id: "item-0", data: "d0", index: 0 },
      { id: "item-1", data: "d1", index: 1 },
    ];
    const executor = jest.fn();
    const entityId = "parent-step";

    const initialResultSummary = JSON.stringify({
      type: "MapResult",
      totalCount: 1,
      successCount: 1,
      failureCount: 0,
      completionReason: "MIN_SUCCESSFUL_REACHED",
      status: "SUCCEEDED",
      // Deliberately no itemStatuses: legacy checkpoint.
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
      // Item 0 finished: its single operation is terminal.
      if (id === `${entityId}-1-1`) {
        return {
          Id: id,
          Type: OperationType.STEP,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
        };
      }
      // Item 1 was mid-flight: first operation done, second still STARTED.
      if (id === `${entityId}-2-1`) {
        return {
          Id: id,
          Type: OperationType.STEP,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
        };
      }
      if (id === `${entityId}-2-2`) {
        return {
          Id: id,
          Type: OperationType.STEP,
          StartTimestamp: new Date(),
          Status: OperationStatus.STARTED,
        };
      }
      // Virtual item contexts are never checkpointed.
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
    executor.mockResolvedValue("result0");

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      { nesting: NestingType.FLAT },
      DurableExecutionMode.ReplaySucceededContext,
      entityId,
      mockExecutionContext,
    );

    // Only item 0 is rebuilt. Item 1 is skipped, not re-driven.
    expect(result.successCount).toBe(1);
    expect(result.totalCount).toBe(1);
    expect(mockParentContext.runInChildContext).toHaveBeenCalledTimes(1);
    expect(mockSkipNextOperation).toHaveBeenCalledTimes(1);
  });

  it("rebuilds virtual items from recorded per-item statuses, including ones that checkpointed nothing", async () => {
    // A virtual item whose body creates no durable operation leaves no trace at
    // all, so no probe can distinguish it from an item that never started. The
    // per-item statuses recorded in the summary are the only signal, and they
    // also settle the ambiguity of a mid-flight multi-operation item.
    //
    // Item 0 succeeded with no operations of its own, item 1 failed, item 2 was
    // never completed.
    const items = [
      { id: "item-0", data: "d0", index: 0 },
      { id: "item-1", data: "d1", index: 1 },
      { id: "item-2", data: "d2", index: 2 },
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
      itemStatuses: "SF-",
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
      // Nothing checkpointed beneath any item.
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
    executor
      .mockResolvedValueOnce("result0")
      .mockRejectedValueOnce(new Error("item 1 failed"));

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      { nesting: NestingType.FLAT },
      DurableExecutionMode.ReplaySucceededContext,
      entityId,
      mockExecutionContext,
    );

    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);
    expect(result.totalCount).toBe(2);
    // Items 0 and 1 re-driven; item 2 skipped.
    expect(mockParentContext.runInChildContext).toHaveBeenCalledTimes(2);
    expect(mockSkipNextOperation).toHaveBeenCalledTimes(1);
  });

  it("prefers recorded statuses over an item's own context checkpoint", async () => {
    // Pins the precedence. The recorded statuses are what the live BatchResult
    // contained, so they win over the item's context record: a child that
    // settled after the batch completed early has a terminal context but was
    // never part of the live result, and rebuilding it would add an item the
    // live run never reported.
    //
    // Item 1 here has a SUCCEEDED context AND a SUCCEEDED first operation, yet
    // the recorded statuses say it did not complete. It must stay non-terminal.
    const items = [
      { id: "item-0", data: "d0", index: 0 },
      { id: "item-1", data: "d1", index: 1 },
    ];
    const executor = jest.fn();
    const entityId = "parent-step";

    const initialResultSummary = JSON.stringify({
      type: "MapResult",
      totalCount: 1,
      successCount: 1,
      failureCount: 0,
      completionReason: "MIN_SUCCESSFUL_REACHED",
      status: "SUCCEEDED",
      itemStatuses: "S-",
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
      // Both items have terminal records of their own; only the statuses
      // distinguish them.
      if (
        id === `${entityId}-1` ||
        id === `${entityId}-2` ||
        id === `${entityId}-1-1` ||
        id === `${entityId}-2-1`
      ) {
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
    executor.mockResolvedValue("result0");

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
    expect(result.totalCount).toBe(1);
    expect(mockParentContext.runInChildContext).toHaveBeenCalledTimes(1);
    expect(mockSkipNextOperation).toHaveBeenCalledTimes(1);
  });

  it("reads per-item statuses from a full BatchResult payload (childOperationsDepth path)", async () => {
    // childOperationsDepth sets ReplayChildren while checkpointing the FULL
    // serialized result, so the summary generator never runs and there is no
    // itemStatuses field. That payload already carries `all: [{ index, status }]`,
    // which is read as the same signal — otherwise this path would still drop
    // FLAT items with no durable operations of their own.
    const items = [
      { id: "item-0", data: "d0", index: 0 },
      { id: "item-1", data: "d1", index: 1 },
      { id: "item-2", data: "d2", index: 2 },
    ];
    const executor = jest.fn();
    const entityId = "parent-step";

    const fullResultPayload = JSON.stringify({
      all: [
        { index: 0, result: "r0", status: "SUCCEEDED" },
        { index: 1, error: { message: "boom" }, status: "FAILED" },
        { index: 2, status: "STARTED" },
      ],
      completionReason: "ALL_COMPLETED",
    });

    mockExecutionContext.getStepData.mockImplementation((id: string) => {
      if (id === entityId) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          ContextDetails: { Result: fullResultPayload },
        };
      }
      // Virtual items: nothing checkpointed beneath them.
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
    executor
      .mockResolvedValueOnce("result0")
      .mockRejectedValueOnce(new Error("item 1 failed"));

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      { nesting: NestingType.FLAT },
      DurableExecutionMode.ReplaySucceededContext,
      entityId,
      mockExecutionContext,
    );

    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);
    expect(mockParentContext.runInChildContext).toHaveBeenCalledTimes(2);
    expect(mockSkipNextOperation).toHaveBeenCalledTimes(1);
  });

  it("ignores a crafted or malformed itemStatuses value and falls back", async () => {
    // Legacy payloads can carry arbitrary JSON. A value outside the marker
    // alphabet must not be read as terminality; replay falls back to the item's
    // own records instead.
    const items = [{ id: "item-0", data: "d0", index: 0 }];
    const executor = jest.fn();
    const entityId = "parent-step";

    const craftedSummary = JSON.stringify({
      type: "MapResult",
      totalCount: 1,
      successCount: 1,
      failureCount: 0,
      completionReason: "ALL_COMPLETED",
      status: "SUCCEEDED",
      itemStatuses: "not-markers",
    });

    mockExecutionContext.getStepData.mockImplementation((id: string) => {
      if (id === entityId) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          ContextDetails: { Result: craftedSummary },
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
    executor.mockResolvedValue("result0");

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      {},
      DurableExecutionMode.ReplaySucceededContext,
      entityId,
      mockExecutionContext,
    );

    // Rebuilt from the context record, not from the crafted string.
    expect(result.successCount).toBe(1);
  });

  it("skips an item whose recorded status is terminal but whose context checkpoint is not", async () => {
    // The other direction of the disagreement, and the one that must not
    // re-drive. Skipping an item the statuses call finished is benign; re-driving
    // one whose context checkpoint is still non-terminal hangs: in
    // ReplaySucceededContext, runInChildContext goes through
    // checkForNonResolvingPromise, which returns a never-resolving promise when
    // the pending step id has a non-terminal checkpoint. replayItems would await
    // it forever, the invocation would time out, and the retry would land in the
    // same state (issue #751).
    //
    // Item 1 is marked "S" but its context record is STARTED, so it is skipped.
    const items = [
      { id: "item-0", data: "d0", index: 0 },
      { id: "item-1", data: "d1", index: 1 },
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
      itemStatuses: "SS",
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
      // Item 1's context never finished, despite the recorded "S".
      if (id === `${entityId}-2`) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.STARTED,
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
    executor.mockResolvedValue("result0");

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      {},
      DurableExecutionMode.ReplaySucceededContext,
      entityId,
      mockExecutionContext,
    );

    // Only item 0 rebuilt; item 1 skipped rather than re-driven into a hang.
    expect(result.successCount).toBe(1);
    expect(mockParentContext.runInChildContext).toHaveBeenCalledTimes(1);
    expect(mockSkipNextOperation).toHaveBeenCalledTimes(1);
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

  it("should reconstruct from checkpoints (not re-run) when no summary is present", async () => {
    // In ReplaySucceededContext mode the controller must NOT fall back to
    // concurrent execution — doing so is what caused the replay hang (a
    // non-terminal child yields a never-resolving promise in this mode). With
    // no child checkpoints, the single item was never started in the live run,
    // so it is omitted rather than re-executed.
    const items = [{ id: "item-0", data: "data1", index: 0 }];
    const executor = jest.fn().mockResolvedValue("result");
    const entityId = "parent-step";

    mockExecutionContext.getStepData.mockImplementation((id: string) => {
      if (id === entityId) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          ContextDetails: {},
        };
      }
      // No child checkpoints.
      return undefined;
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

    expect(result.successCount).toBe(0);
    expect(result.totalCount).toBe(0);
    // Critically: the item is not re-executed, so no hang is possible.
    expect(mockParentContext.runInChildContext).not.toHaveBeenCalled();
  });

  it("should reconstruct from checkpoints when the summary is unparseable (no concurrent fallback)", async () => {
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

  // Regression: GitHub issue #751.
  // Repro 1 — a summarized map/parallel (aggregate result > checkpoint limit)
  // with live in-flight items must replay to the SAME BatchResult shape the
  // live run observed. Previously replay dropped STARTED children, so a run
  // that observed totalCount:5 / startedCount:3 / indexes [0..4] replayed as
  // totalCount:2 / startedCount:0 / indexes [0,1].
  it("should replay a summarized batch that completed early with in-flight items, returning completed items only (issue #751 repro 1)", async () => {
    const items = [
      { id: "item-0", data: "d0", index: 0 },
      { id: "item-1", data: "d1", index: 1 },
      { id: "item-2", data: "d2", index: 2 },
      { id: "item-3", data: "d3", index: 3 },
      { id: "item-4", data: "d4", index: 4 },
    ];
    const executor = jest.fn();
    const entityId = "parent-step";

    // Envelope written by the default (composed) generator on the live run.
    const initialResultSummary = JSON.stringify({
      type: "MapResult",
      totalCount: 5,
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
      // Items 0 and 1 completed; items 2, 3, 4 were started and still in flight
      // (each wrote a START checkpoint before suspending on a wait).
      if (id === `${entityId}-1` || id === `${entityId}-2`) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
        };
      }
      if (
        id === `${entityId}-3` ||
        id === `${entityId}-4` ||
        id === `${entityId}-5`
      ) {
        return {
          Id: id,
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.STARTED,
        };
      }
      return undefined;
    });

    mockParentContext.runInChildContext
      .mockResolvedValueOnce("result0")
      .mockResolvedValueOnce("result1");

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      { completionConfig: { minSuccessful: 2 } },
      DurableExecutionMode.ReplaySucceededContext,
      entityId,
      mockExecutionContext,
    );

    // Reconstruction returns only the completed items; in-flight (STARTED)
    // children are not rebuilt. The recorded completionReason carries the
    // outcome. totalCount reflects the completed items (2), not the live 5.
    expect(result.totalCount).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.startedCount).toBe(0);
    expect(result.all.map((i) => i.index)).toEqual([0, 1]);
    expect(result.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
    // Only terminal children are re-driven; in-flight ones are not re-executed.
    expect(mockParentContext.runInChildContext).toHaveBeenCalledTimes(2);
  });

  // Repro 2 — a custom summaryGenerator whose output is not JSON with a numeric
  // totalCount. Previously this made replay fall back to concurrent execution
  // in ReplaySucceededContext mode, where a non-terminal child yields a
  // never-resolving promise and the batch could never settle (hang). Replay
  // must instead reconstruct from child checkpoints and complete.
  it("should not hang when the summary is a free-form custom string (issue #751 repro 2)", async () => {
    const items = [
      { id: "item-0", data: "d0", index: 0 },
      { id: "item-1", data: "d1", index: 1 },
      { id: "item-2", data: "d2", index: 2 },
    ];
    const executor = jest.fn();
    const entityId = "parent-step";

    // A legacy/free-form custom-generator payload (pre-fix): not JSON.
    const initialResultSummary = "processed 2/3 items";

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
      // Items 0 and 2 completed; item 1 still in flight (non-terminal) — the
      // exact condition that previously hung the replay.
      if (id === `${entityId}-1` || id === `${entityId}-3`) {
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
          Status: OperationStatus.STARTED,
        };
      }
      return undefined;
    });

    mockParentContext.runInChildContext
      .mockResolvedValueOnce("result0")
      .mockResolvedValueOnce("result2");

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      { maxConcurrency: 2, completionConfig: { minSuccessful: 2 } },
      DurableExecutionMode.ReplaySucceededContext,
      entityId,
      mockExecutionContext,
    );

    // Completes (no hang). The in-flight middle item is skipped, not rebuilt,
    // so the result holds the two completed items (indexes 0 and 2).
    expect(result.totalCount).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.startedCount).toBe(0);
    expect(result.all.map((i) => i.index)).toEqual([0, 2]);
    // No recorded completionReason in the free-form summary, so it is re-inferred.
    expect(result.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
    expect(mockParentContext.runInChildContext).toHaveBeenCalledTimes(2);
  });

  it("ignores an unrecognised completionReason in the summary and re-infers it", async () => {
    const items = [
      { id: "item-0", data: "d0", index: 0 },
      { id: "item-1", data: "d1", index: 1 },
      { id: "item-2", data: "d2", index: 2 },
    ];
    const executor = jest.fn();
    const entityId = "parent-step";

    // A malformed / hand-authored summary carrying a bogus completionReason.
    // "constructor" is deliberate: it is a real Object.prototype key, so a `in`
    // check would wrongly accept it — validation must use hasOwnProperty.
    const initialResultSummary = JSON.stringify({
      type: "MapResult",
      totalCount: 3,
      successCount: 2,
      completionReason: "constructor",
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
      // Items 0 and 1 completed; item 2 never started.
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

    mockParentContext.runInChildContext
      .mockResolvedValueOnce("result0")
      .mockResolvedValueOnce("result1");

    const result = await controller.executeItems(
      items,
      executor,
      mockParentContext,
      { completionConfig: { minSuccessful: 2 } },
      DurableExecutionMode.ReplaySucceededContext,
      entityId,
      mockExecutionContext,
    );

    // The bogus value must NOT leak into BatchResult; the reason is re-inferred
    // (2 successes reached minSuccessful while item 2 never completed).
    expect(result.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
    expect(result.completionReason).not.toBe("constructor");
  });
});
