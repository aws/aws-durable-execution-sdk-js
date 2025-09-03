import { BatchItemStatus } from "../../types";

export interface BatchItem<R> {
  result?: R;
  error?: Error;
  index: number;
  status: BatchItemStatus;
}

export interface BatchResult<R> {
  all: Array<BatchItem<R>>;

  succeeded(): Array<BatchItem<R> & { result: R }>;
  failed(): Array<BatchItem<R> & { error: Error }>;
  started(): Array<BatchItem<R> & { status: BatchItemStatus.STARTED }>;

  status: BatchItemStatus.SUCCEEDED | BatchItemStatus.FAILED;
  completionReason:
    | "ALL_COMPLETED"
    | "MIN_SUCCESSFUL_REACHED"
    | "FAILURE_TOLERANCE_EXCEEDED";
  hasFailure: boolean;

  throwIfError(): void;
  getResults(): Array<R>;
  getErrors(): Array<Error>;

  successCount: number;
  failureCount: number;
  startedCount: number;
  totalCount: number;
}

export class BatchResultImpl<R> implements BatchResult<R> {
  constructor(
    public readonly all: Array<BatchItem<R>>,
    public readonly completionReason:
      | "ALL_COMPLETED"
      | "MIN_SUCCESSFUL_REACHED"
      | "FAILURE_TOLERANCE_EXCEEDED" = "ALL_COMPLETED",
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

/**
 * Restores methods to deserialized BatchResult data
 */
export function restoreBatchResult<R>(data: any): BatchResult<R> {
  if (data && typeof data === "object" && Array.isArray(data.all)) {
    // Restore Error objects
    const restoredItems = data.all.map((item: any) => ({
      ...item,
      error: item.error
        ? Object.assign(new Error(item.error.message), item.error)
        : undefined,
    }));

    return new BatchResultImpl<R>(restoredItems, data.completionReason);
  }

  return new BatchResultImpl<R>([]);
}
