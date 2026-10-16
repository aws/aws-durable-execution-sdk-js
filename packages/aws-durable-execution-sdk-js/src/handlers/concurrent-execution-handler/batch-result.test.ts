import {
  BatchResultImpl,
  restoreBatchResult,
  createBatchResultSerdes,
} from "./batch-result";
import { BatchItem, BatchItemStatus } from "../../types";
import {
  ChildContextError,
  CallbackError,
} from "../../errors/durable-error/durable-error";
import { MockBatchResult } from "../../testing/mock-batch-result";

class CustomError extends Error {
  additionalProperty = 1;
}

describe("BatchResult", () => {
  describe("BatchItemStatus", () => {
    it("should have correct enum values", () => {
      expect(BatchItemStatus.SUCCEEDED).toBe("SUCCEEDED");
      expect(BatchItemStatus.FAILED).toBe("FAILED");
      expect(BatchItemStatus.STARTED).toBe("STARTED");
    });
  });

  describe("BatchResultImpl", () => {
    it("keeps successful undefined results in branch order", () => {
      const items: BatchItem<number | undefined>[] = [
        { index: 0, status: BatchItemStatus.SUCCEEDED, result: undefined },
        { index: 1, status: BatchItemStatus.SUCCEEDED, result: 10 },
        { index: 2, status: BatchItemStatus.SUCCEEDED, result: undefined },
        { index: 3, status: BatchItemStatus.SUCCEEDED, result: 30 },
      ];
      const result = new BatchResultImpl(items, "ALL_COMPLETED");

      expect(result.successCount).toBe(4);
      expect(result.succeeded()).toStrictEqual(items);
      expect(result.getResults()).toStrictEqual([undefined, 10, undefined, 30]);
    });

    it("keeps failed items and errors in branch order", () => {
      const firstError = new ChildContextError("first failure");
      const secondError = new ChildContextError("second failure");
      const items: BatchItem<number>[] = [
        { index: 0, status: BatchItemStatus.FAILED, error: firstError },
        { index: 1, status: BatchItemStatus.FAILED, error: secondError },
      ];
      const result = new BatchResultImpl(items, "ALL_COMPLETED");

      expect(result.failureCount).toBe(2);
      expect(result.failed()).toStrictEqual(items);
      expect(result.getErrors()).toStrictEqual([firstError, secondError]);
      let thrown: unknown;
      try {
        result.throwIfError();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(firstError);
    });

    it("keeps mixed status views separate and handles an empty batch", () => {
      const error = new ChildContextError("mixed failure");
      const mixed = new BatchResultImpl<number | undefined>(
        [
          { index: 0, status: BatchItemStatus.SUCCEEDED, result: undefined },
          { index: 1, status: BatchItemStatus.FAILED, error },
          { index: 2, status: BatchItemStatus.STARTED },
          { index: 3, status: BatchItemStatus.SUCCEEDED, result: 30 },
        ],
        "ALL_COMPLETED",
      );
      expect([
        mixed.successCount,
        mixed.failureCount,
        mixed.startedCount,
      ]).toEqual([2, 1, 1]);
      expect(mixed.succeeded().map((item) => item.index)).toEqual([0, 3]);
      expect(mixed.getResults()).toStrictEqual([undefined, 30]);
      expect(mixed.failed().map((item) => item.index)).toEqual([1]);
      expect(mixed.getErrors()).toStrictEqual([error]);
      expect(mixed.started().map((item) => item.index)).toEqual([2]);

      const empty = new BatchResultImpl<number>([], "ALL_COMPLETED");
      expect([
        empty.totalCount,
        empty.successCount,
        empty.failureCount,
      ]).toEqual([0, 0, 0]);
      expect(empty.succeeded()).toEqual([]);
      expect(empty.failed()).toEqual([]);
      expect(empty.getResults()).toEqual([]);
      expect(empty.getErrors()).toEqual([]);
    });

    it("keeps the test mock aligned with status-based batch views", () => {
      const firstError = new ChildContextError("first mock failure");
      const secondError = new ChildContextError("second mock failure");
      const mock = new MockBatchResult<number | undefined>([
        { index: 0, status: BatchItemStatus.SUCCEEDED, result: undefined },
        { index: 1, status: BatchItemStatus.FAILED, error: firstError },
        { index: 2, status: BatchItemStatus.SUCCEEDED, result: 10 },
        { index: 3, status: BatchItemStatus.FAILED, error: secondError },
      ]);

      expect(mock.succeeded().map((item) => item.index)).toEqual([0, 2]);
      expect(mock.getResults()).toStrictEqual([undefined, 10]);
      expect(mock.failed().map((item) => item.index)).toEqual([1, 3]);
      expect(mock.getErrors()).toStrictEqual([firstError, secondError]);
      let thrown: unknown;
      try {
        mock.throwIfError();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(firstError);
    });

    it("should handle all success items", () => {
      const items: BatchItem<string>[] = [
        { index: 0, result: "success1", status: BatchItemStatus.SUCCEEDED },
        { index: 1, result: "success2", status: BatchItemStatus.SUCCEEDED },
      ];
      const result = new BatchResultImpl(items, "ALL_COMPLETED");

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
      const error = new ChildContextError("test error");
      const items: BatchItem<string>[] = [
        { index: 0, result: "success", status: BatchItemStatus.SUCCEEDED },
        { index: 1, error, status: BatchItemStatus.FAILED },
      ];
      const result = new BatchResultImpl(items, "ALL_COMPLETED");

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
      const result = new BatchResultImpl(items, "ALL_COMPLETED");

      expect(result.started()).toHaveLength(1);
      expect(result.startedCount).toBe(1);
      expect(result.status).toBe(BatchItemStatus.SUCCEEDED); // Status is SUCCESS when no failures
    });

    it("should throw on throwIfError with failures", () => {
      const items: BatchItem<string>[] = [
        {
          index: 0,
          error: new ChildContextError("test"),
          status: BatchItemStatus.FAILED,
        },
      ];
      const result = new BatchResultImpl(items, "ALL_COMPLETED");

      expect(() => result.throwIfError()).toThrow("test");
    });

    it("should not throw on throwIfError without failures", () => {
      const items: BatchItem<string>[] = [
        { index: 0, result: "success", status: BatchItemStatus.SUCCEEDED },
      ];
      const result = new BatchResultImpl(items, "ALL_COMPLETED");

      expect(() => result.throwIfError()).not.toThrow();
    });
  });

  describe("restoreBatchResult", () => {
    it("preserves undefined successful results through batch serialization", async () => {
      const serdes = createBatchResultSerdes<number | undefined>();
      const original = new BatchResultImpl<number | undefined>(
        [
          { index: 0, status: BatchItemStatus.SUCCEEDED, result: undefined },
          { index: 1, status: BatchItemStatus.SUCCEEDED, result: 10 },
        ],
        "ALL_COMPLETED",
      );
      const context = { entityId: "test", durableExecutionArn: "arn:test" };
      const serialized = await serdes.serialize(original, context);
      const restored = await serdes.deserialize(serialized, context);

      expect(restored?.successCount).toBe(2);
      expect(restored?.succeeded().map((item) => item.index)).toEqual([0, 1]);
      expect(restored?.getResults()).toStrictEqual([undefined, 10]);
    });

    it("should restore BatchResult with DurableOperationError objects", () => {
      const data = {
        all: [
          { index: 0, result: "success", status: BatchItemStatus.SUCCEEDED },
          {
            index: 1,
            error: {
              ErrorType: "ChildContextError",
              ErrorMessage: "test error",
              StackTrace: ["stack trace"],
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

    it("should preserve custom error properties through serialization", () => {
      // Simulate what happens when a ChildContextError with custom cause is serialized
      const data = {
        all: [
          {
            index: 0,
            error: {
              ErrorType: "ChildContextError",
              ErrorMessage: "My error",
              StackTrace: ["at ..."],
              // This simulates the cause being serialized as ErrorData
              ErrorData: JSON.stringify({ additionalProperty: 1 }),
            },
            status: BatchItemStatus.FAILED,
          },
        ],
        completionReason: "ALL_COMPLETED",
      };

      const result = restoreBatchResult(data);
      const failedItem = result.failed()[0];

      expect(failedItem.error).toBeInstanceOf(Error);
      expect(failedItem.error.message).toBe("My error");
      expect(failedItem.error).toHaveProperty("errorData");
    });

    it("should handle data without all property", () => {
      const result = restoreBatchResult({});
      expect(result.all).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it("should preserve ChildContextError with custom cause through serialization round-trip", async () => {
      // Create a ChildContextError with a custom error cause (simulating map/parallel failure)
      const customError = new CustomError("My error");
      const childContextError = new ChildContextError(
        customError.message,
        customError,
      );

      const items: BatchItem<string>[] = [
        { index: 0, error: childContextError, status: BatchItemStatus.FAILED },
      ];
      const batchResult = new BatchResultImpl(items, "ALL_COMPLETED");

      // Use the BatchResult serdes for serialization
      const serdes = createBatchResultSerdes<string>();
      const serialized = await serdes.serialize(batchResult, {
        entityId: "test",
        durableExecutionArn: "arn:test",
      });
      const restored = await serdes.deserialize(serialized, {
        entityId: "test",
        durableExecutionArn: "arn:test",
      });

      // Verify the error is properly restored
      const failedItem = restored!.failed()[0];
      expect(failedItem.error).toBeInstanceOf(Error);
      expect(failedItem.error.message).toBe("My error");
      expect(failedItem.error).toHaveProperty("errorType", "ChildContextError");
      expect(failedItem.error).toHaveProperty("cause");
      expect(failedItem.error.cause).toBeInstanceOf(Error);
    });

    it("should preserve the original error type and message of the cause through serialization round-trip", async () => {
      // ChildContextError wrapping a CallbackError, as produced by map/parallel
      // when an item throws a durable error.
      const callbackError = new CallbackError("Custom callback error message");
      const childContextError = new ChildContextError(
        callbackError.message,
        callbackError,
      );

      const items: BatchItem<string>[] = [
        { index: 0, error: childContextError, status: BatchItemStatus.FAILED },
      ];
      const batchResult = new BatchResultImpl(items, "ALL_COMPLETED");

      const serdes = createBatchResultSerdes<string>();
      const serialized = await serdes.serialize(batchResult, {
        entityId: "test",
        durableExecutionArn: "arn:test",
      });
      const restored = await serdes.deserialize(serialized, {
        entityId: "test",
        durableExecutionArn: "arn:test",
      });

      const failedItem = restored!.failed()[0];
      // The wrapper type/message are preserved...
      expect(failedItem.error.errorType).toBe("ChildContextError");
      expect(failedItem.error.message).toBe("Custom callback error message");
      // ...and so is the original cause's type and message (not flattened into
      // a generic StepError("Unknown error")).
      const cause = failedItem.error.cause as { errorType?: string } & Error;
      expect(cause).toBeInstanceOf(Error);
      expect(cause.errorType).toBe("CallbackError");
      expect(cause.message).toBe("Custom callback error message");
    });

    it("should return BatchResultImpl instance as-is when passed directly", () => {
      // Create a BatchResultImpl with a ChildContextError
      const customError = new CallbackError("Should be preserved");
      const childContextError = new ChildContextError(
        customError.message,
        customError,
      );

      const items: BatchItem<string>[] = [
        { index: 0, error: childContextError, status: BatchItemStatus.FAILED },
      ];
      const originalBatchResult = new BatchResultImpl(items, "ALL_COMPLETED");

      // Pass the BatchResultImpl instance directly to restoreBatchResult
      const result = restoreBatchResult(originalBatchResult);

      // Should return the same instance
      expect(result).toBe(originalBatchResult);

      // Error should be preserved exactly
      const failedItem = result.failed()[0];
      expect(failedItem.error).toBe(childContextError);
      expect(failedItem.error.message).toBe("Should be preserved");
      expect(failedItem.error.errorType).toBe("ChildContextError");
      expect(failedItem.error.cause).toBe(customError);
    });
  });
});
