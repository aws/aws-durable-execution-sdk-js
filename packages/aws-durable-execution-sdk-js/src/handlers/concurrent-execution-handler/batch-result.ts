import { ErrorObject } from "@aws-sdk/client-lambda";
import {
  BatchItemStatus,
  BatchItem,
  BatchResult,
  CompletionReason,
} from "../../types";
import {
  DurableOperationError,
  ChildContextError,
  BatchCompletionError,
} from "../../errors/durable-error/durable-error";
import { Serdes, SerdesContext } from "../../utils/serdes/serdes";

/**
 * Durable error type names that can be reconstructed into their concrete
 * {@link DurableOperationError} subclass (preserving `errorType`).
 */
const KNOWN_DURABLE_ERROR_TYPES = new Set([
  "StepError",
  "CallbackError",
  "CallbackExternalError",
  "CallbackTimeoutError",
  "CallbackSubmitterError",
  "InvokeError",
  "ChildContextError",
  "PromiseCombinatorError",
  "WaitForConditionError",
]);

/**
 * Wire representation of a batch item error. Extends the standard
 * {@link ErrorObject} with a nested `Cause` so the original error (type and
 * message) is preserved across the serialize/deserialize round-trip. The base
 * {@link ErrorObject} format has no field for the cause, so it would otherwise
 * be dropped and rebuilt as a generic error.
 */
interface SerializedBatchError extends ErrorObject {
  Cause?: SerializedBatchError;
}

/** Serialize an Error (and its cause chain) into a SerializedBatchError. */
function serializeBatchError(
  error: Error | undefined,
): SerializedBatchError | undefined {
  if (!error) {
    return undefined;
  }

  const serialized: SerializedBatchError =
    error instanceof DurableOperationError
      ? error.toErrorObject()
      : { ErrorType: error.name, ErrorMessage: error.message };

  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    serialized.Cause = serializeBatchError(cause);
  }

  return serialized;
}

/** Reconstruct an Error (and its cause chain) from a SerializedBatchError. */
function reconstructBatchError(errorObject: SerializedBatchError): Error {
  let error: Error;
  if (
    errorObject.ErrorType &&
    KNOWN_DURABLE_ERROR_TYPES.has(errorObject.ErrorType)
  ) {
    error = DurableOperationError.fromErrorObject(errorObject);
  } else {
    error = new Error(errorObject.ErrorMessage);
    error.name = errorObject.ErrorType || "Error";
    error.stack = errorObject.StackTrace?.join("\n");
  }

  // Override the cause with the reconstructed original error when present so
  // the cause's type and message survive (fromErrorObject otherwise synthesizes
  // a generic cause from the top-level fields).
  if (errorObject.Cause) {
    (error as { cause?: Error }).cause = reconstructBatchError(
      errorObject.Cause,
    );
  }

  return error;
}

export class BatchResultImpl<R> implements BatchResult<R> {
  constructor(
    public readonly all: Array<BatchItem<R>>,
    public readonly completionReason: CompletionReason,
  ) {}

  succeeded(): Array<BatchItem<R> & { result: R }> {
    return this.all.filter(
      (item): item is BatchItem<R> & { result: R } =>
        item.status === BatchItemStatus.SUCCEEDED && item.result !== undefined,
    );
  }

  failed(): Array<BatchItem<R> & { error: ChildContextError }> {
    return this.all.filter(
      (item): item is BatchItem<R> & { error: ChildContextError } =>
        item.status === BatchItemStatus.FAILED && item.error !== undefined,
    );
  }

  started(): Array<BatchItem<R> & { status: BatchItemStatus.STARTED }> {
    return this.all.filter(
      (item): item is BatchItem<R> & { status: BatchItemStatus.STARTED } =>
        item.status === BatchItemStatus.STARTED,
    );
  }

  get status(): BatchItemStatus.SUCCEEDED | BatchItemStatus.FAILED {
    // A custom completion decision is authoritative for the overall outcome,
    // even when it disagrees with the individual item results (e.g. a quorum
    // that can no longer be met completes as FAILED with no failed item).
    if (this.completionReason === "CUSTOM_COMPLETION_FAILED") {
      return BatchItemStatus.FAILED;
    }
    if (this.completionReason === "CUSTOM_COMPLETION_SUCCEEDED") {
      return BatchItemStatus.SUCCEEDED;
    }
    return this.hasFailure ? BatchItemStatus.FAILED : BatchItemStatus.SUCCEEDED;
  }

  get hasFailure(): boolean {
    return this.all.some((item) => item.status === BatchItemStatus.FAILED);
  }

  throwIfError(): void {
    const firstError = this.all.find(
      (item) => item.status === BatchItemStatus.FAILED,
    )?.error;
    if (firstError) {
      throw firstError;
    }
    // The custom completion decision marked the batch as failed even though no
    // individual item failed (e.g. a required quorum could not be met).
    if (this.status === BatchItemStatus.FAILED) {
      throw new BatchCompletionError(this.completionReason);
    }
  }

  getResults(): Array<R> {
    return this.succeeded().map((item) => item.result);
  }

  getErrors(): Array<ChildContextError> {
    return this.failed().map((item) => item.error);
  }

  get successCount(): number {
    return this.all.filter((item) => item.status === BatchItemStatus.SUCCEEDED)
      .length;
  }

  get failureCount(): number {
    return this.all.filter((item) => item.status === BatchItemStatus.FAILED)
      .length;
  }

  get startedCount(): number {
    return this.all.filter((item) => item.status === BatchItemStatus.STARTED)
      .length;
  }

  get totalCount(): number {
    return this.all.length;
  }
}

interface SerializedBatchItem {
  result?: unknown;
  error?: ErrorObject;
  index: number;
  status: BatchItemStatus;
}

interface SerializedBatchResult {
  all: SerializedBatchItem[];
  completionReason: CompletionReason;
}

/**
 * Restores methods to deserialized BatchResult data
 */
export function restoreBatchResult<R>(data: unknown): BatchResult<R> {
  // If data is already a BatchResultImpl instance, return it as-is
  if (data instanceof BatchResultImpl) {
    return data;
  }

  if (
    data &&
    typeof data === "object" &&
    "all" in data &&
    Array.isArray(data.all)
  ) {
    const serializedData = data as SerializedBatchResult;
    // Restore Error objects
    const restoredItems = serializedData.all.map(
      (item: SerializedBatchItem): BatchItem<R> => ({
        ...item,
        result: item.result as R,
        error: item.error
          ? (reconstructBatchError(
              item.error as SerializedBatchError,
            ) as ChildContextError)
          : undefined,
      }),
    );

    return new BatchResultImpl<R>(
      restoredItems,
      serializedData.completionReason,
    );
  }

  return new BatchResultImpl<R>([], "ALL_COMPLETED");
}

/**
 * Creates a Serdes for BatchResult that properly handles error serialization
 */
export function createBatchResultSerdes<R>(): Serdes<BatchResult<R>> {
  return {
    serialize: async (
      value: BatchResult<R> | undefined,
      _context: SerdesContext,
    ): Promise<string | undefined> => {
      if (!value) return undefined;

      const serialized = {
        all: value.all.map((item) => ({
          ...item,
          error:
            item.error instanceof Error
              ? serializeBatchError(item.error)
              : undefined,
        })),
        completionReason: value.completionReason,
      };

      return JSON.stringify(serialized);
    },

    deserialize: async (
      data: string | undefined,
      _context: SerdesContext,
    ): Promise<BatchResult<R> | undefined> => {
      if (!data) return undefined;
      return restoreBatchResult<R>(JSON.parse(data));
    },
  };
}
