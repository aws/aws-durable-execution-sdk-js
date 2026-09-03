import {
  createParallelSummaryGenerator,
  createMapSummaryGenerator,
  composeSummaryGenerator,
  encodeItemStatuses,
} from "./summary-generators";
import { BatchResultImpl } from "../../handlers/concurrent-execution-handler/batch-result";
import { BatchItemStatus } from "../../types";
import { ChildContextError } from "../../errors/durable-error/durable-error";
import { CHECKPOINT_SIZE_LIMIT_BYTES } from "../constants/constants";

describe("Summary Generators", () => {
  describe("createParallelSummaryGenerator", () => {
    it("should generate summary for successful parallel result", () => {
      const batchResult = new BatchResultImpl(
        [
          { index: 0, result: "result1", status: BatchItemStatus.SUCCEEDED },
          { index: 1, result: "result2", status: BatchItemStatus.SUCCEEDED },
        ],
        "ALL_COMPLETED",
      );

      const summaryGenerator = createParallelSummaryGenerator();
      const summary = summaryGenerator(batchResult);
      const parsed = JSON.parse(summary);

      expect(parsed).toEqual({
        type: "ParallelResult",
        totalCount: 2,
        successCount: 2,
        failureCount: 0,
        startedCount: 0,
        completionReason: "ALL_COMPLETED",
        status: BatchItemStatus.SUCCEEDED,
        itemStatuses: "SS",
      });
    });

    it("should generate summary for failed parallel result", () => {
      const error = new ChildContextError("Test error");
      const batchResult = new BatchResultImpl(
        [
          { index: 0, result: "result1", status: BatchItemStatus.SUCCEEDED },
          { index: 1, error, status: BatchItemStatus.FAILED },
        ],
        "ALL_COMPLETED",
      );

      const summaryGenerator = createParallelSummaryGenerator();
      const summary = summaryGenerator(batchResult);
      const parsed = JSON.parse(summary);

      expect(parsed).toEqual({
        type: "ParallelResult",
        totalCount: 2,
        successCount: 1,
        failureCount: 1,
        startedCount: 0,
        completionReason: "ALL_COMPLETED",
        status: BatchItemStatus.FAILED,
        itemStatuses: "SF",
      });
    });

    it("should generate summary for early completion", () => {
      const batchResult = new BatchResultImpl(
        [
          { index: 0, result: "result1", status: BatchItemStatus.SUCCEEDED },
          { index: 1, status: BatchItemStatus.STARTED },
        ],
        "MIN_SUCCESSFUL_REACHED",
      );

      const summaryGenerator = createParallelSummaryGenerator();
      const summary = summaryGenerator(batchResult);
      const parsed = JSON.parse(summary);

      expect(parsed).toEqual({
        type: "ParallelResult",
        totalCount: 2,
        successCount: 1,
        failureCount: 0,
        startedCount: 1,
        completionReason: "MIN_SUCCESSFUL_REACHED",
        status: BatchItemStatus.SUCCEEDED,
        itemStatuses: "S-",
      });
    });
  });

  describe("createMapSummaryGenerator", () => {
    it("should generate summary for successful map result", () => {
      const batchResult = new BatchResultImpl(
        [
          { index: 0, result: "mapped1", status: BatchItemStatus.SUCCEEDED },
          { index: 1, result: "mapped2", status: BatchItemStatus.SUCCEEDED },
          { index: 2, result: "mapped3", status: BatchItemStatus.SUCCEEDED },
        ],
        "ALL_COMPLETED",
      );

      const summaryGenerator = createMapSummaryGenerator();
      const summary = summaryGenerator(batchResult);
      const parsed = JSON.parse(summary);

      expect(parsed).toEqual({
        type: "MapResult",
        totalCount: 3,
        successCount: 3,
        failureCount: 0,
        completionReason: "ALL_COMPLETED",
        status: BatchItemStatus.SUCCEEDED,
        itemStatuses: "SSS",
      });
    });

    it("should generate summary for failed map result", () => {
      const error = new ChildContextError("Mapping failed");
      const batchResult = new BatchResultImpl(
        [
          { index: 0, result: "mapped1", status: BatchItemStatus.SUCCEEDED },
          { index: 1, error, status: BatchItemStatus.FAILED },
          { index: 2, result: "mapped3", status: BatchItemStatus.SUCCEEDED },
        ],
        "ALL_COMPLETED",
      );

      const summaryGenerator = createMapSummaryGenerator();
      const summary = summaryGenerator(batchResult);
      const parsed = JSON.parse(summary);

      expect(parsed).toEqual({
        type: "MapResult",
        totalCount: 3,
        successCount: 2,
        failureCount: 1,
        completionReason: "ALL_COMPLETED",
        status: BatchItemStatus.FAILED,
        itemStatuses: "SFS",
      });
    });

    it("should generate summary for failure tolerance exceeded", () => {
      const error1 = new ChildContextError("Error 1");
      const error2 = new ChildContextError("Error 2");
      const batchResult = new BatchResultImpl(
        [
          { index: 0, error: error1, status: BatchItemStatus.FAILED },
          { index: 1, error: error2, status: BatchItemStatus.FAILED },
        ],
        "FAILURE_TOLERANCE_EXCEEDED",
      );

      const summaryGenerator = createMapSummaryGenerator();
      const summary = summaryGenerator(batchResult);
      const parsed = JSON.parse(summary);

      expect(parsed).toEqual({
        type: "MapResult",
        totalCount: 2,
        successCount: 0,
        failureCount: 2,
        completionReason: "FAILURE_TOLERANCE_EXCEEDED",
        status: BatchItemStatus.FAILED,
        itemStatuses: "FF",
      });
    });
  });

  describe("composeSummaryGenerator", () => {
    it("returns the internal record unchanged when no custom generator is given", () => {
      const batchResult = new BatchResultImpl(
        [{ index: 0, result: "r1", status: BatchItemStatus.SUCCEEDED }],
        "ALL_COMPLETED",
      );
      const composed = composeSummaryGenerator(createMapSummaryGenerator());

      expect(composed(batchResult)).toBe(
        createMapSummaryGenerator()(batchResult),
      );
    });

    it("always preserves the SDK record and nests custom output under `summary`", () => {
      const batchResult = new BatchResultImpl(
        [
          { index: 0, result: "r1", status: BatchItemStatus.SUCCEEDED },
          { index: 1, status: BatchItemStatus.STARTED },
        ],
        "MIN_SUCCESSFUL_REACHED",
      );
      const custom = (): string => "processed 1/2 items";
      const composed = composeSummaryGenerator(
        createMapSummaryGenerator(),
        custom,
      );

      const parsed = JSON.parse(composed(batchResult));

      // Load-bearing SDK fields survive regardless of the custom output...
      expect(parsed).toMatchObject({
        type: "MapResult",
        totalCount: 2,
        successCount: 1,
        failureCount: 0,
        completionReason: "MIN_SUCCESSFUL_REACHED",
      });
      // ...and the customer string is preserved verbatim, observability-only.
      expect(parsed.summary).toBe("processed 1/2 items");
    });

    it("keeps a JSON-shaped custom output as a verbatim string under `summary`", () => {
      const batchResult = new BatchResultImpl(
        [{ index: 0, result: "r1", status: BatchItemStatus.SUCCEEDED }],
        "ALL_COMPLETED",
      );
      // A custom generator that itself returns JSON must NOT collide with or
      // overwrite the SDK metadata keys — it is stored as an opaque string.
      const custom = (): string =>
        JSON.stringify({ totalCount: 999, mine: true });
      const composed = composeSummaryGenerator(
        createParallelSummaryGenerator(),
        custom,
      );

      const parsed = JSON.parse(composed(batchResult));

      expect(parsed.totalCount).toBe(1); // SDK value, not the custom 999
      expect(parsed.summary).toBe('{"totalCount":999,"mine":true}');
    });
  });

  describe("encodeItemStatuses", () => {
    it("marks succeeded, failed and unfinished items in index order", () => {
      const error = new ChildContextError("boom");
      const batchResult = new BatchResultImpl(
        [
          { index: 0, result: "r0", status: BatchItemStatus.SUCCEEDED },
          { index: 1, error, status: BatchItemStatus.FAILED },
          { index: 2, status: BatchItemStatus.STARTED },
        ],
        "ALL_COMPLETED",
      );

      expect(encodeItemStatuses(batchResult)).toBe("SF-");
    });

    it("leaves gaps for items absent from the result entirely", () => {
      // A batch that completed early may never record an item at all. It must
      // read as unfinished so replay does not rebuild (or re-execute) it.
      const batchResult = new BatchResultImpl(
        [
          { index: 0, result: "r0", status: BatchItemStatus.SUCCEEDED },
          { index: 3, result: "r3", status: BatchItemStatus.SUCCEEDED },
        ],
        "MIN_SUCCESSFUL_REACHED",
      );

      expect(encodeItemStatuses(batchResult)).toBe("S--S");
    });

    it("returns an empty string for an empty batch", () => {
      expect(encodeItemStatuses(new BatchResultImpl([], "ALL_COMPLETED"))).toBe(
        "",
      );
    });

    it("stays compact for large batches (one character per item)", () => {
      const items = Array.from({ length: 2000 }, (_, index) => ({
        index,
        result: "r",
        status: BatchItemStatus.SUCCEEDED,
      }));
      const encoded = encodeItemStatuses(
        new BatchResultImpl(items, "ALL_COMPLETED"),
      );

      expect(encoded.length).toBe(2000);
      expect(encoded).toBe("S".repeat(2000));
    });
  });

  describe("size is bounded by the operation limit", () => {
    it("stays far inside the checkpoint limit at the largest batch the service allows", () => {
      // Every batch item runs its body inside a context, and a context is meant
      // to wrap at least one durable operation, so each item costs at least one.
      // The service caps an execution at 30,000 operations, so no batch reaches
      // more than about that many items. At one byte per marker the whole summary
      // stays an order of magnitude inside the 256 KB checkpoint limit, which is
      // why no size handling is needed — and why adding a cap would be harmful,
      // since dropping the field sends replay back to a probe that cannot recover
      // an item whose body created no durable operation.
      const SERVICE_OPERATION_LIMIT = 30_000;
      const items = Array.from(
        { length: SERVICE_OPERATION_LIMIT },
        (_, index) => ({
          index,
          result: "r",
          status: BatchItemStatus.SUCCEEDED,
        }),
      );

      const summary = createMapSummaryGenerator()(
        new BatchResultImpl(items, "ALL_COMPLETED"),
      );

      expect(JSON.parse(summary).itemStatuses).toBe(
        "S".repeat(SERVICE_OPERATION_LIMIT),
      );
      expect(Buffer.byteLength(summary, "utf8")).toBeLessThan(
        CHECKPOINT_SIZE_LIMIT_BYTES / 8,
      );
    });
  });

  describe("summary generator return types", () => {
    it("should return string from parallel summary generator", () => {
      const batchResult = new BatchResultImpl([], "ALL_COMPLETED");
      const summaryGenerator = createParallelSummaryGenerator();
      const summary = summaryGenerator(batchResult);

      expect(typeof summary).toBe("string");
      expect(() => JSON.parse(summary)).not.toThrow();
    });

    it("should return string from map summary generator", () => {
      const batchResult = new BatchResultImpl([], "ALL_COMPLETED");
      const summaryGenerator = createMapSummaryGenerator();
      const summary = summaryGenerator(batchResult);

      expect(typeof summary).toBe("string");
      expect(() => JSON.parse(summary)).not.toThrow();
    });
  });
});
