import { BatchResultImpl, restoreBatchResult } from "./batch-result";
import { BatchItem, BatchItemStatus } from "../../types";

describe("BatchResult", () => {
  describe("BatchItemStatus", () => {
    it("should have correct enum values", () => {
      expect(BatchItemStatus.SUCCEEDED).toBe("SUCCEEDED");
      expect(BatchItemStatus.FAILED).toBe("FAILED");
      expect(BatchItemStatus.STARTED).toBe("STARTED");
    });
  });

  describe("BatchResultImpl", () => {
    it("should handle all success items", () => {
      const items: BatchItem<string>[] = [
        { index: 0, result: "success1", status: BatchItemStatus.SUCCEEDED },
        { index: 1, result: "success2", status: BatchItemStatus.SUCCEEDED },
      ];
      const result = new BatchResultImpl(items);

      expect(result.all).toEqual(items);
      expect(result.succeeded()).toEqual(items);
      expect(result.failed()).toEqual([]);
      expect(result.started()).toEqual([]);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
      expect(result.startedCount).toBe(0);
      expect(result.status).toBe(BatchItemStatus.SUCCEEDED);
      expect(result.getResults()).toEqual(["success1", "success2"]);
      expect(result.getErrors()).toEqual([]);
      expect(result.totalCount).toBe(2);
    });

    it("should handle mixed success and failure", () => {
      const error = new Error("test error");
      const items: BatchItem<string>[] = [
        { index: 0, result: "success", status: BatchItemStatus.SUCCEEDED },
        { index: 1, error, status: BatchItemStatus.FAILED },
      ];
      const result = new BatchResultImpl(items);

      expect(result.succeeded()).toHaveLength(1);
      expect(result.failed()).toHaveLength(1);
      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.status).toBe(BatchItemStatus.FAILED);
      expect(result.getResults()).toEqual(["success"]);
      expect(result.getErrors()).toEqual([error]);
    });

    it("should handle started items", () => {
      const items: BatchItem<string>[] = [
        { index: 0, result: "success", status: BatchItemStatus.SUCCEEDED },
        { index: 1, status: BatchItemStatus.STARTED },
      ];
      const result = new BatchResultImpl(items);

      expect(result.started()).toHaveLength(1);
      expect(result.startedCount).toBe(1);
      expect(result.status).toBe(BatchItemStatus.SUCCEEDED); // Status is SUCCESS when no failures
    });

    it("should throw on throwIfError with failures", () => {
      const items: BatchItem<string>[] = [
        { index: 0, error: new Error("test"), status: BatchItemStatus.FAILED },
      ];
      const result = new BatchResultImpl(items);

      expect(() => result.throwIfError()).toThrow("test");
    });

    it("should not throw on throwIfError without failures", () => {
      const items: BatchItem<string>[] = [
        { index: 0, result: "success", status: BatchItemStatus.SUCCEEDED },
      ];
      const result = new BatchResultImpl(items);

      expect(() => result.throwIfError()).not.toThrow();
    });
  });

  describe("restoreBatchResult", () => {
    it("should restore BatchResult with Error objects", () => {
      const data = {
        all: [
          { index: 0, result: "success", status: BatchItemStatus.SUCCEEDED },
          {
            index: 1,
            error: {
              name: "Error",
              message: "test error",
              stack: "stack trace",
            },
            status: BatchItemStatus.FAILED,
          },
        ],
      };

      const result = restoreBatchResult(data);

      expect(result.all[0]).toEqual({
        index: 0,
        result: "success",
        status: BatchItemStatus.SUCCEEDED,
      });
      expect(result.all[1].error).toBeInstanceOf(Error);
      expect(result.all[1].error?.message).toBe("test error");
      expect(result.succeeded()).toHaveLength(1);
      expect(result.failed()).toHaveLength(1);
    });

    it("should handle data without errors", () => {
      const data = {
        all: [
          { index: 0, result: "success", status: BatchItemStatus.SUCCEEDED },
        ],
      };

      const result = restoreBatchResult(data);

      expect(result.all).toEqual(data.all);
      expect(result.successCount).toBe(1);
    });

    it("should handle empty data", () => {
      const result = restoreBatchResult(null);
      expect(result.all).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it("should handle data without all property", () => {
      const result = restoreBatchResult({});
      expect(result.all).toEqual([]);
      expect(result.totalCount).toBe(0);
    });
  });
});
