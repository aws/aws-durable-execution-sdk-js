import {
  createParallelSummaryGenerator,
  createMapSummaryGenerator,
} from "./summary-generators";
import { BatchResultImpl } from "../handlers/concurrent-execution-handler/batch-result";
import { BatchItemStatus } from "../types";

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
      });
    });

    it("should generate summary for failed parallel result", () => {
      const error = new Error("Test error");
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
      });
    });

    it("should generate summary for failed map result", () => {
      const error = new Error("Mapping failed");
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
      });
    });

    it("should generate summary for failure tolerance exceeded", () => {
      const error1 = new Error("Error 1");
      const error2 = new Error("Error 2");
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
      });
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
