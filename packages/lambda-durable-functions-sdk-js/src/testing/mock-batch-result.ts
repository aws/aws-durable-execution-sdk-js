import {
  BatchResult,
  BatchItem,
} from "../handlers/concurrent-execution-handler/batch-result";
import { BatchItemStatus } from "../types";

export class MockBatchResult<R> implements BatchResult<R> {
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
