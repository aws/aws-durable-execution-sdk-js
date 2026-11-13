import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";
import { createDistributedMapHandler } from "./distributed-map-handler";
import {
  ExecutionContext,
  DistributedMapProcessor,
  DistributedMapSource,
  DistributedMapSummary,
} from "../../types";
import { DurablePromise } from "../../types/durable-promise";
import { OperationStatus } from "../../types/wire";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { SerdesContext } from "../../utils/serdes/serdes";

// The counts the service sends at every terminal state. TotalCount is required for SUCCEEDED.
const COUNTS = {
  SuccessCount: 0,
  FailureCount: 0,
  ReadCount: 0,
  TotalCount: 0,
};

vi.mock("../../utils/logger/logger");

describe("Distributed map handler two-phase execution", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let createStepId: () => string;
  const processor = DistributedMapProcessor.reportBatchOutcome("proc-fn");

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = {
      getStepData: vi.fn().mockReturnValue(null),
      terminationManager: {
        terminate: vi.fn(),
        isTerminationRequested: vi.fn().mockReturnValue(false),
      },
      durableExecutionArn: "test-arn",
      isOperationUpdatedBetweenInvocation: vi.fn().mockReturnValue(false),
    } as any;
    mockCheckpoint = {
      checkpoint: vi.fn().mockResolvedValue(undefined),
      markOperationState: vi.fn(),
      markOperationAwaited: vi.fn(),
      waitForStatusChange: vi.fn().mockResolvedValue(undefined),
    } as any;
    createStepId = vi.fn().mockReturnValue("step-1");
  });

  it("terminates for maxConcurrency=0 without throwing synchronously", async () => {
    const handler = createDistributedMapHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    // The returned promise never settles (the execution is terminated), so we
    // don't await it -- just assert the termination was requested.
    void handler([], processor, 0);
    await Promise.resolve();

    expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "CONFIG_VALIDATION_ERROR",
        message: expect.stringContaining("Invalid maxConcurrency: 0"),
      }),
    );
  });

  it("terminates for a non-array non-source value without throwing synchronously", async () => {
    const handler = createDistributedMapHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    let promise: DurablePromise<DistributedMapSummary> | undefined;
    expect(() => {
      promise = handler(
        { not: "a source" } as any,
        processor,
        5,
      ) as DurablePromise<DistributedMapSummary>;
    }).not.toThrow();
    expect(promise).toBeInstanceOf(DurablePromise);

    await Promise.resolve();

    expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "CONFIG_VALIDATION_ERROR",
        message: expect.stringContaining("Invalid source"),
      }),
    );
  });

  it("terminates when an inline source exceeds the 1 MB limit", async () => {
    const handler = createDistributedMapHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    const oversized = [{ blob: "x".repeat(1_200_000) }];
    void handler(oversized, processor, 2);
    await new Promise((r) => setImmediate(r));

    expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "CONFIG_VALIDATION_ERROR",
        message: expect.stringContaining("exceeds the 1 MB limit"),
      }),
    );
    expect(mockCheckpoint.checkpoint).not.toHaveBeenCalled();
  });

  it("terminates when an inline item serializes to no string", async () => {
    const handler = createDistributedMapHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    void handler([1, undefined], processor, 2);
    await new Promise((r) => setImmediate(r));

    expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "CONFIG_VALIDATION_ERROR",
        message: expect.stringContaining("inline item 1"),
      }),
    );
    expect(mockCheckpoint.checkpoint).not.toHaveBeenCalled();
  });

  it("terminates when the reader initialState serializes to no string", async () => {
    const handler = createDistributedMapHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );
    const source = DistributedMapSource.reader.fromFunction("reader-fn", {
      initialState: { page: 0 },
      stateSerdes: {
        serialize: async () => undefined,
        deserialize: async () => undefined,
      },
    });

    void handler(source, processor, 2);
    await new Promise((r) => setImmediate(r));

    expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "CONFIG_VALIDATION_ERROR",
        message: expect.stringContaining("reader initialState"),
      }),
    );
    expect(mockCheckpoint.checkpoint).not.toHaveBeenCalled();
  });

  it("terminates for a fractional timeout", async () => {
    const handler = createDistributedMapHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    void handler([1], processor, 2, { timeout: { seconds: 1.5 } });
    await Promise.resolve();

    expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "CONFIG_VALIDATION_ERROR",
        message: expect.stringContaining("Invalid timeout"),
      }),
    );
  });

  it("does not validate the config on replay", async () => {
    // A replay never sends the start-only configuration, so it is not validated again.
    (mockContext.getStepData as Mock).mockReturnValue({
      Status: OperationStatus.SUCCEEDED,
      DistributedMapDetails: { ...COUNTS },
    });
    const handler = createDistributedMapHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    const result = await (handler(
      [],
      processor,
      0,
    ) as DurablePromise<DistributedMapSummary>);

    expect(mockContext.terminationManager.terminate).not.toHaveBeenCalled();
    expect(result.status).toBe("SUCCEEDED");
  });

  it("names the status when a terminal operation carries no details", async () => {
    (mockContext.getStepData as Mock).mockReturnValue({
      Status: OperationStatus.FAILED,
    });
    const handler = createDistributedMapHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    await expect(
      handler([1], processor, 2) as DurablePromise<DistributedMapSummary>,
    ).rejects.toThrow("ended FAILED but carried no DistributedMapDetails");
  });

  it("sends a non-JSON serdes output as the inline item, unchanged", async () => {
    (mockContext.getStepData as Mock)
      .mockReturnValueOnce(null)
      .mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        DistributedMapDetails: { ...COUNTS, SuccessCount: 1, FailureCount: 0 },
      });

    const handler = createDistributedMapHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    const source = DistributedMapSource.inline([1], {
      serdes: {
        serialize: async (): Promise<string> => "not json {",
        deserialize: async (d: string | undefined): Promise<number> =>
          d as unknown as number,
      },
    });
    const result = await (handler(
      source,
      processor,
      2,
    ) as DurablePromise<DistributedMapSummary>);

    const update = (mockCheckpoint.checkpoint as Mock).mock.calls[0][1];
    expect(
      update.DistributedMapOptions.Source.InlineSourceConfig.Items,
    ).toEqual(["not json {"]);
    expect(result.status).toBe("SUCCEEDED");
  });

  it("sends only the items present when the call started", async () => {
    (mockContext.getStepData as Mock)
      .mockReturnValueOnce(null)
      .mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        DistributedMapDetails: { ...COUNTS, SuccessCount: 2, FailureCount: 0 },
      });
    const handler = createDistributedMapHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    const items = [1, 2];
    const source = DistributedMapSource.inline(items, {
      serdes: {
        serialize: async (v: number | undefined): Promise<string> => {
          // The caller adds an item while the first item is still serializing.
          if (v === 1) items.push(3);
          await Promise.resolve();
          return String(v);
        },
        deserialize: async (d: string | undefined): Promise<number> =>
          Number(d),
      },
    });
    await (handler(
      source,
      processor,
      2,
    ) as DurablePromise<DistributedMapSummary>);

    const update = (mockCheckpoint.checkpoint as Mock).mock.calls[0][1];
    expect(
      update.DistributedMapOptions.Source.InlineSourceConfig.Items,
    ).toEqual(["1", "2"]);
  });

  it("serializes each inline item with its own child step id context", async () => {
    (mockContext.getStepData as Mock)
      .mockReturnValueOnce(null)
      .mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        DistributedMapDetails: { ...COUNTS, SuccessCount: 2, FailureCount: 0 },
      });
    const handler = createDistributedMapHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );
    const contexts: SerdesContext[] = [];
    const source = DistributedMapSource.inline([1, 2], {
      serdes: {
        serialize: async (v, context): Promise<string> => {
          contexts.push(context);
          return String(v);
        },
        deserialize: async (d): Promise<number> => Number(d),
      },
    });

    await (handler(
      source,
      processor,
      2,
    ) as DurablePromise<DistributedMapSummary>);

    expect(contexts).toEqual([
      { entityId: "step-1-1", durableExecutionArn: "test-arn" },
      { entityId: "step-1-2", durableExecutionArn: "test-arn" },
    ]);
  });

  it("resolves a FAILED run with its counts instead of throwing", async () => {
    (mockContext.getStepData as Mock)
      .mockReturnValueOnce(null)
      .mockReturnValue({
        Status: OperationStatus.FAILED,
        DistributedMapDetails: {
          ...COUNTS,
          TotalCount: 10,
          SuccessCount: 7,
          FailureCount: 3,
          ReadCount: 0,
        },
      });

    const handler = createDistributedMapHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    const result = await (handler(
      [],
      processor,
      2,
    ) as DurablePromise<DistributedMapSummary>);

    expect(result.status).toBe("FAILED");
    expect(result.successCount).toBe(7);
    expect(result.failureCount).toBe(3);
    expect(result.totalCount).toBe(10);
    expect(result.hasFailure).toBe(true);
    // Raising is opt-in, the same contract map and parallel use.
    expect(() => result.throwIfError()).toThrow("Map run ended FAILED");
  });

  it("checkpoints START in phase 1 then resolves after phase-2 waitForStatusChange", async () => {
    (mockContext.getStepData as Mock)
      .mockReturnValueOnce(null) // phase 1: no step data yet -> triggers START checkpoint
      .mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        DistributedMapDetails: { ...COUNTS, SuccessCount: 0, FailureCount: 0 },
      });

    const handler = createDistributedMapHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    const promise = handler(
      [],
      processor,
      2,
    ) as DurablePromise<DistributedMapSummary>;
    const result = await promise;

    expect(mockCheckpoint.checkpoint).toHaveBeenCalledTimes(1);
    expect(mockCheckpoint.markOperationAwaited).toHaveBeenCalledWith("step-1");
    expect(mockCheckpoint.waitForStatusChange).toHaveBeenCalledWith("step-1");
    expect(result.status).toBe("SUCCEEDED");
  });

  it("keeps waiting while the run is STARTED", async () => {
    // The status depends on how many waits have resolved: PENDING after START, then STARTED,
    // then SUCCEEDED.
    let waits = 0;
    (mockCheckpoint.waitForStatusChange as Mock).mockImplementation(
      async () => {
        waits++;
      },
    );
    (mockContext.getStepData as Mock).mockImplementation(() => {
      if ((mockCheckpoint.checkpoint as Mock).mock.calls.length === 0) {
        return null;
      }
      if (waits === 0) return { Status: OperationStatus.PENDING };
      if (waits === 1) return { Status: OperationStatus.STARTED };
      return {
        Status: OperationStatus.SUCCEEDED,
        DistributedMapDetails: { ...COUNTS },
      };
    });
    const handler = createDistributedMapHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    const result = await (handler(
      [],
      processor,
      2,
    ) as DurablePromise<DistributedMapSummary>);

    expect(mockCheckpoint.waitForStatusChange).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("SUCCEEDED");
  });

  it.each([
    ["CANCELLED", OperationStatus.CANCELLED],
    ["SOMETHING_NEW", "SOMETHING_NEW" as OperationStatus],
  ])("resolves a replayed %s run without waiting", async (_label, status) => {
    (mockContext.getStepData as Mock).mockReturnValue({
      Status: status,
      DistributedMapDetails: { ...COUNTS },
    });
    const handler = createDistributedMapHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
    );

    const result = await (handler(
      [],
      processor,
      2,
    ) as DurablePromise<DistributedMapSummary>);

    expect(mockCheckpoint.markOperationAwaited).not.toHaveBeenCalled();
    expect(mockCheckpoint.waitForStatusChange).not.toHaveBeenCalled();
    expect(result.status).toBe("UNKNOWN_TO_SDK_VERSION");
  });
});
