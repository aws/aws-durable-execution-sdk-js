import { BatchItemStatus, BatchItem, BatchResult } from "../../types";
import { DurableOperationError } from "../../errors/durable-error/durable-error";
import { ErrorObject } from "@aws-sdk/client-lambda";

export class BatchResultImpl<R> implements BatchResult<R> {
  constructor(
    public readonly all: Array<BatchItem<R>>,
    public readonly completionReason:
      | "ALL_COMPLETED"
      | "MIN_SUCCESSFUL_REACHED"
      | "FAILURE_TOLERANCE_EXCEEDED",
  ) {}

  succeeded(): Array<BatchItem<R> & { result: R }> {
    return this.all.filter(
      (item): item is BatchItem<R> & { result: R } =>
        item.status === BatchItemStatus.SUCCEEDED && item.result !== undefined,
    );
  }

  failed(): Array<BatchItem<R> & { error: Error }> {
    return this.all.filter(
      (item): item is BatchItem<R> & { error: Error } =>
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
  }

  getResults(): Array<R> {
    return this.succeeded().map((item) => item.result);
  }

  getErrors(): Array<Error> {
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
  error?: { message: string; [key: string]: unknown };
  index: number;
  status: BatchItemStatus;
}

interface SerializedBatchResult {
  all: SerializedBatchItem[];
  completionReason:
    | "ALL_COMPLETED"
    | "MIN_SUCCESSFUL_REACHED"
    | "FAILURE_TOLERANCE_EXCEEDED";
}

/**
 * Restores methods to deserialized BatchResult data
 */
export function restoreBatchResult<R>(data: unknown): BatchResult<R> {
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
          ? DurableOperationError.fromErrorObject(item.error as ErrorObject)
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
