import { describe, it, expect } from "vitest";
import { buildSummary } from "./distributed-map-handler";
import {
  DistributedMapResultImpl,
  DistributedMapSummaryFields,
  DistributedMapSummaryImpl,
} from "./distributed-map-result";
import {
  DistributedMapItemStatus,
  DistributedMapResultItem,
  DistributedMapStatus,
} from "../../types";
import { defaultSerdes } from "../../utils/serdes/serdes";
import {
  DistributedMapError,
  DistributedMapItemError,
} from "../../errors/durable-error/durable-error";

const fakeContext = {
  terminationManager: {} as any,
  durableExecutionArn: "arn:test",
} as any;

/** Summary fields for a run, with the counts every terminal state carries. */
const fieldsWith = (
  overrides: Partial<DistributedMapSummaryFields> = {},
): DistributedMapSummaryFields => ({
  status: DistributedMapStatus.SUCCEEDED,
  successCount: 0,
  failureCount: 0,
  readCount: 0,
  totalCount: 0,
  ...overrides,
});

const succeededItem = (
  itemId: string,
  result?: unknown,
): DistributedMapResultItem<unknown> => ({
  itemId,
  status: DistributedMapItemStatus.SUCCEEDED,
  result,
});

const failedItem = (
  itemId: string,
  error?: DistributedMapItemError,
): DistributedMapResultItem<unknown> => ({
  itemId,
  status: DistributedMapItemStatus.FAILED,
  error,
});

describe("Distributed map result construction", () => {
  it("builds a summary without collection and a result with collection", async () => {
    const details = {
      SuccessCount: 0,
      FailureCount: 0,
      ReadCount: 0,
      TotalCount: 0,
    };
    const args = [
      "step-0",
      undefined,
      fakeContext,
      defaultSerdes,
      "SUCCEEDED",
    ] as const;

    const summary = await buildSummary(details, {}, ...args);
    const result = await buildSummary(
      details,
      { collectResults: true },
      ...args,
    );

    expect(summary).toBeInstanceOf(DistributedMapSummaryImpl);
    expect(summary).not.toBeInstanceOf(DistributedMapResultImpl);
    expect(result).toBeInstanceOf(DistributedMapResultImpl);
  });

  it("derives hasFailure from the failure count", () => {
    expect(new DistributedMapSummaryImpl(fieldsWith()).hasFailure).toBe(false);
    expect(
      new DistributedMapSummaryImpl(fieldsWith({ failureCount: 1 })).hasFailure,
    ).toBe(true);
  });
});

describe("Distributed map collected result access", () => {
  it("keeps a succeeded item with no output in getResults as undefined", () => {
    const result = new DistributedMapResultImpl(
      fieldsWith({ successCount: 1 }),
      [succeededItem("0")],
    );

    // toEqual([undefined]) also matches [], so check the length and the entry.
    expect(result.getResults()).toHaveLength(1);
    expect(result.getResults()[0]).toBeUndefined();
    expect(result.succeeded()).toHaveLength(1);
    expect(result.all).toHaveLength(1);
  });

  it("keeps a failed item with no error in getErrors as undefined", () => {
    const result = new DistributedMapResultImpl(
      fieldsWith({ failureCount: 1 }),
      [failedItem("0")],
    );

    expect(result.failed()).toHaveLength(1);
    // toEqual([undefined]) also matches [], so check the length and the entry.
    expect(result.getErrors()).toHaveLength(1);
    expect(result.getErrors()[0]).toBeUndefined();
    expect(result.all).toHaveLength(1);
  });
});

describe("Distributed map throwIfError", () => {
  it("throws the first failed item's error under inline collection", () => {
    const itemError = new DistributedMapItemError("kaboom");
    const result = new DistributedMapResultImpl(
      fieldsWith({ failureCount: 1 }),
      [failedItem("0", itemError)],
    );
    let thrown: unknown;
    try {
      result.throwIfError();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(result.getErrors()[0]);
    expect(thrown).toBeInstanceOf(DistributedMapItemError);
    expect((thrown as DistributedMapItemError).message).toBe("kaboom");
  });

  it("names the failed item when it carries no error detail", () => {
    const result = new DistributedMapResultImpl(
      fieldsWith({ failureCount: 1 }),
      [failedItem("7")],
    );
    expect(() => result.throwIfError()).toThrow("item 7 failed");
  });

  it("falls back to the failure count when no failed item is retained", () => {
    const result = new DistributedMapResultImpl(
      fieldsWith({ failureCount: 2 }),
      [],
    );
    expect(() => result.throwIfError()).toThrow(
      "Map run succeeded but 2 item(s) permanently failed",
    );
  });

  it("throws a run-level error for a non-succeeded run", () => {
    const result = new DistributedMapResultImpl(
      fieldsWith({ status: DistributedMapStatus.FAILED, failureCount: 1 }),
      [failedItem("0")],
    );
    expect(() => result.throwIfError()).toThrow("Map run ended FAILED");
  });

  it("throws the run Error's message, type and data for a non-succeeded run", () => {
    const result = new DistributedMapResultImpl(
      fieldsWith({
        status: DistributedMapStatus.FAILED,
        error: {
          ErrorType: "SourceReadError",
          ErrorMessage: "object not found",
          ErrorData: '{"key":"k"}',
          StackTrace: ["at reader"],
        },
      }),
      [],
    );
    let thrown: DistributedMapError | undefined;
    try {
      result.throwIfError();
    } catch (e) {
      thrown = e as DistributedMapError;
    }
    expect(thrown).toBeInstanceOf(DistributedMapError);
    expect(thrown?.message).toBe("Map run ended FAILED: object not found");
    expect(thrown?.cause?.name).toBe("SourceReadError");
    expect(thrown?.cause?.stack).toBe("at reader");
    expect(thrown?.errorData).toBe('{"key":"k"}');
  });

  it("does not throw on a clean success", () => {
    const result = new DistributedMapResultImpl(
      fieldsWith({ successCount: 1 }),
      [succeededItem("0", 1)],
    );
    expect(() => result.throwIfError()).not.toThrow();
  });

  it("throws from the summary alone when result collection is off", () => {
    const summary = new DistributedMapSummaryImpl(
      fieldsWith({ failureCount: 3 }),
    );
    expect(() => summary.throwIfError()).toThrow(
      "Map run succeeded but 3 item(s) permanently failed",
    );
  });
});
