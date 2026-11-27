import {
  type DistributedMapSummary,
  type DistributedMapResult,
  type DistributedMapResultItem,
  DistributedMapStatus,
  DistributedMapItemStatus,
} from "../../types";
import {
  DistributedMapError,
  type DistributedMapItemError,
} from "../../errors/durable-error/durable-error";
import type { ErrorObject } from "../../types/wire";

/** The summary fields the service reports. hasFailure is derived from failureCount. */
export type DistributedMapSummaryFields = Omit<
  DistributedMapSummary,
  "hasFailure" | "throwIfError"
>;

type SucceededItem<TOutput> = DistributedMapResultItem<TOutput> & {
  status: DistributedMapItemStatus.SUCCEEDED;
};
type FailedItem<TOutput> = DistributedMapResultItem<TOutput> & {
  status: DistributedMapItemStatus.FAILED;
};

/** @internal */
export class DistributedMapSummaryImpl implements DistributedMapSummary {
  readonly distributedMapRunArn?: string | undefined;
  readonly status: DistributedMapStatus;
  readonly sourceExhausted?: boolean | undefined;
  readonly error?: ErrorObject | undefined;
  readonly hasFailure: boolean;
  readonly successCount: number;
  readonly failureCount: number;
  readonly readCount: number;
  readonly totalCount?: number | undefined;

  constructor(fields: DistributedMapSummaryFields) {
    this.distributedMapRunArn = fields.distributedMapRunArn;
    this.status = fields.status;
    this.sourceExhausted = fields.sourceExhausted;
    this.error = fields.error;
    this.hasFailure = fields.failureCount > 0;
    this.successCount = fields.successCount;
    this.failureCount = fields.failureCount;
    this.readCount = fields.readCount;
    this.totalCount = fields.totalCount;
  }

  throwIfError(): void {
    if (this.status !== DistributedMapStatus.SUCCEEDED) {
      throw DistributedMapError.fromRunErrorObject(this.status, this.error);
    }
    if (this.failureCount > 0) {
      throw new DistributedMapError(
        `Map run succeeded but ${this.failureCount} item(s) permanently failed`,
      );
    }
  }
}

/** @internal */
export class DistributedMapResultImpl<TOutput>
  extends DistributedMapSummaryImpl
  implements DistributedMapResult<TOutput>
{
  constructor(
    fields: DistributedMapSummaryFields,
    readonly all: Array<DistributedMapResultItem<TOutput>>,
  ) {
    super(fields);
  }

  succeeded(): Array<SucceededItem<TOutput>> {
    return this.all.filter(
      (i): i is SucceededItem<TOutput> =>
        i.status === DistributedMapItemStatus.SUCCEEDED,
    );
  }

  failed(): Array<FailedItem<TOutput>> {
    return this.all.filter(
      (i): i is FailedItem<TOutput> =>
        i.status === DistributedMapItemStatus.FAILED,
    );
  }

  getResults(): Array<TOutput | undefined> {
    return this.succeeded().map((i) => i.result);
  }

  getErrors(): Array<DistributedMapItemError | undefined> {
    return this.failed().map((i) => i.error);
  }

  // For inline collection, throw the first failed item's error, otherwise use the summary rule.
  throwIfError(): void {
    if (
      this.status === DistributedMapStatus.SUCCEEDED &&
      this.failureCount > 0
    ) {
      const firstFailed = this.all.find(
        (i) => i.status === DistributedMapItemStatus.FAILED,
      );
      if (firstFailed) {
        throw (
          firstFailed.error ??
          new DistributedMapError(`item ${firstFailed.itemId} failed`)
        );
      }
    }
    super.throwIfError();
  }
}
