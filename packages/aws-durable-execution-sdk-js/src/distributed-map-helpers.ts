import type { Context } from "aws-lambda";
import {
  type Serdes,
  type AnySerdes,
  type SerdesContext,
  defaultSerdes,
} from "./utils/serdes/serdes";
import {
  type DurableContext,
  type DurableExecutionConfig,
  type DurableLambdaHandler,
  BatchItemStatus,
  type DistributedMapItemContext,
  type DistributedMapBatchContext,
  type DistributedMapReaderContext,
} from "./types";
import { withDurableExecution } from "./with-durable-execution";
import { createErrorObjectFromError } from "./utils/error-object/error-object";
import {
  dmapSerdesContext,
  parseDistributedMapRunArn,
} from "./handlers/distributed-map-handler/distributed-map-serdes-context";

const READER_STATE_LIMIT = 32 * 1024;

/** A page returned by a reader function, its items and the next state. @public */
export interface DistributedMapReaderPage<TItem, TState> {
  items: TItem[];
  nextState?: TState;
}

interface ProcessorRecord {
  itemId: string;
  /** The item as a serialized string, deserialized by the configured item serdes. */
  body: string;
}

interface ProcessorEvent {
  distributedMapRunArn: string;
  records: ProcessorRecord[];
}

interface ReaderEvent {
  distributedMapRunArn: string;
  state?: string | null;
  maxItemsPerPage: number;
}

/** Error details for one failed item in an item handler response. @public */
export interface DistributedMapErrorDetail {
  /** The error's name. Absent when the thrown value was not an error. */
  errorType?: string | undefined;
  errorMessage?: string | undefined;
  /** Serialized custom error data, when the error carried it. */
  errorData?: string | undefined;
  /** Stack trace lines, when the SDK is configured to store stack traces. */
  stackTrace?: string[] | undefined;
}

/** One succeeded item in an item handler response. @public */
export interface DistributedMapItemResult {
  itemIdentifier: string;
  /** The output as a serialized string. Absent when the handler returned undefined. */
  output?: string;
}

/** One failed item in an item handler response. @public */
export interface DistributedMapItemFailure {
  itemIdentifier: string;
  /** Absent when the processor reported the failure without details. */
  error?: DistributedMapErrorDetail;
}

/** Response an item handler returns to the distributed map run. @public */
export interface DistributedMapItemHandlerResponse {
  batchItemResults: DistributedMapItemResult[];
  batchItemFailures: DistributedMapItemFailure[];
}

/** Response a reader returns to the distributed map run. @public */
export interface DistributedMapReaderResponse {
  /** Each item as a serialized string, deserialized by the processor's item serdes. */
  items: string[];
  /** The next state as a serialized string, absent when the source is exhausted. */
  nextState?: string;
}

/** Reject a concurrency the pool would otherwise silently coerce (0 to unbounded, negatives to 1). */
function assertConcurrency(concurrency: number | undefined): void {
  if (
    concurrency !== undefined &&
    (!Number.isInteger(concurrency) || concurrency < 1)
  ) {
    throw new Error("concurrency must be an integer of 1 or more");
  }
}

/** Reject an event whose run ARN is missing or does not parse. */
function assertRunArn(event: { distributedMapRunArn?: unknown }): void {
  if (!parseDistributedMapRunArn(event.distributedMapRunArn)) {
    throw new Error(
      "expected a distributed map event with a valid 'distributedMapRunArn'",
    );
  }
}

function itemContextFor(
  event: ProcessorEvent,
  itemId: string,
): DistributedMapItemContext {
  return Object.freeze({
    distributedMapRunArn: event.distributedMapRunArn,
    itemId,
  });
}

function batchContextFor(event: ProcessorEvent): DistributedMapBatchContext {
  return Object.freeze({
    distributedMapRunArn: event.distributedMapRunArn,
    itemIds: Object.freeze(event.records.map((r) => r.itemId)),
  });
}

/** Reject an event that is not a distributed map processor payload. */
function assertProcessorEvent(event: unknown): asserts event is ProcessorEvent {
  const e = event as ProcessorEvent | undefined;
  if (!e || !Array.isArray(e.records)) {
    throw new Error(
      "expected a distributed map processor event with a 'records' array (this handler must be invoked by a distributed map run, not directly)",
    );
  }
  assertRunArn(e);
  for (const record of e.records) {
    if (typeof record?.itemId !== "string" || record.itemId === "") {
      throw new Error(
        "expected each distributed map processor record to have a non-empty string 'itemId'",
      );
    }
  }
}

/** Reject an event that is not a distributed map reader payload. */
function assertReaderEvent(event: unknown): asserts event is ReaderEvent {
  const e = event as ReaderEvent | undefined;
  if (!e || typeof e.maxItemsPerPage !== "number") {
    throw new Error(
      "expected a distributed map reader event with a numeric 'maxItemsPerPage' (this handler must be invoked by a distributed map run, not directly)",
    );
  }
  assertRunArn(e);
}

async function toItem<T>(
  serdes: Serdes<T>,
  body: string,
  ctx: SerdesContext,
): Promise<T> {
  return (await serdes.deserialize(body, ctx)) as T;
}

/**
 * Serializes a handler's return value. Returns undefined when the handler returned undefined or
 * the serdes produced no string. The caller then leaves the item out of batchItemResults, and
 * the service records the item as succeeded with no output.
 */
async function toOutput<T>(
  serdes: Serdes<T>,
  value: T,
  ctx: SerdesContext,
): Promise<string | undefined> {
  if (value === undefined) return undefined;
  return await serdes.serialize(value, ctx);
}

/** Decodes every record body with the item serdes. */
function decodeRecords<T>(
  serdes: AnySerdes,
  event: ProcessorEvent,
): Promise<T[]> {
  return Promise.all(
    event.records.map(
      (r) =>
        toItem(
          serdes,
          r.body,
          dmapSerdesContext(event.distributedMapRunArn, "body", r.itemId),
        ) as Promise<T>,
    ),
  );
}

type ItemOutcome<R> = { ok: true; value: R } | { ok: false; error: unknown };

/** Builds an item handler response. A succeeded item with no output is listed without one. */
function toItemHandlerResponse(
  entries: Array<{ itemId: string; outcome: ItemOutcome<string | undefined> }>,
): DistributedMapItemHandlerResponse {
  const results: DistributedMapItemResult[] = [];
  const failures: DistributedMapItemFailure[] = [];
  for (const { itemId, outcome } of entries) {
    if (outcome.ok) {
      results.push({
        itemIdentifier: itemId,
        ...(outcome.value !== undefined ? { output: outcome.value } : {}),
      });
    } else {
      // The SDK's shared converter, so item errors follow the same rules as other operations' errors.
      const e = createErrorObjectFromError(outcome.error);
      failures.push({
        itemIdentifier: itemId,
        error: {
          errorType: e.ErrorType,
          errorMessage: e.ErrorMessage,
          errorData: e.ErrorData,
          stackTrace: e.StackTrace,
        },
      });
    }
  }
  return { batchItemResults: results, batchItemFailures: failures };
}

async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<ItemOutcome<R>>> {
  const results: Array<ItemOutcome<R>> = new Array(items.length);
  let next = 0;
  const size = Math.max(1, Math.min(limit, items.length || 1));
  const runners = Array.from({ length: size }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) break;
      try {
        // The loop breaks when i >= items.length.
        results[i] = { ok: true, value: await worker(items[i] as T, i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Wrap a Lambda as an item handler, which reports an outcome for each item. Pair it with
 * `DistributedMapProcessor.reportItemOutcomes`.
 *
 * Items are processed one at a time by default. Raising `concurrency` overlaps the handler with
 * itself, so `fn` must tolerate several calls being in flight at once.
 *
 * @public
 */
export function createDistributedMapItemHandler<TItem, TOutput>(
  fn: (
    item: TItem,
    context: DistributedMapItemContext,
  ) => TOutput | Promise<TOutput>,
  opts?: {
    itemSerdes?: Serdes<TItem>;
    resultSerdes?: Serdes<TOutput>;
    /** Handlers in flight at once. Defaults to 1, and must be an integer of 1 or more. */
    concurrency?: number;
  },
): (
  event: unknown,
  context: Context,
) => Promise<DistributedMapItemHandlerResponse> {
  assertConcurrency(opts?.concurrency);
  const itemSerdes = (opts?.itemSerdes ?? defaultSerdes) as AnySerdes;
  const resultSerdes = (opts?.resultSerdes ?? defaultSerdes) as AnySerdes;
  const concurrency = opts?.concurrency ?? 1;

  return async (event: unknown): Promise<DistributedMapItemHandlerResponse> => {
    assertProcessorEvent(event);
    const records = event.records;
    // Serialize inside the worker, so a serialization failure fails only that item.
    const outcomes = await runPool(records, concurrency, async (record) => {
      const runArn = event.distributedMapRunArn;
      const value = await fn(
        (await toItem(
          itemSerdes,
          record.body,
          dmapSerdesContext(runArn, "body", record.itemId),
        )) as TItem,
        itemContextFor(event, record.itemId),
      );
      return await toOutput(
        resultSerdes,
        value,
        dmapSerdesContext(runArn, "output", record.itemId),
      );
    });
    return toItemHandlerResponse(
      // runPool returns one outcome per record, in record order.
      records.map((r, i) => ({
        itemId: r.itemId,
        outcome: outcomes[i] as ItemOutcome<string | undefined>,
      })),
    );
  };
}

/**
 * Wrap a Lambda as a batch handler, where returning passes the batch and throwing fails it.
 * Pair it with `DistributedMapProcessor.reportBatchOutcome`.
 *
 * @public
 */
export function createDistributedMapBatchHandler<TItem>(
  fn: (
    items: TItem[],
    context: DistributedMapBatchContext,
  ) => void | Promise<void>,
  opts?: { itemSerdes?: Serdes<TItem> },
): (event: unknown, context: Context) => Promise<void> {
  const serdes = (opts?.itemSerdes ?? defaultSerdes) as AnySerdes;
  return async (event: unknown): Promise<void> => {
    assertProcessorEvent(event);
    const items = await decodeRecords<TItem>(serdes, event);
    await fn(items, batchContextFor(event));
  };
}

/** Wrap a Lambda as a reader source, a missing nextState means the source is exhausted. @public */
export function createDistributedMapReader<TItem, TState>(
  fn: (
    state: TState | undefined,
    maxItemsPerPage: number,
    context: DistributedMapReaderContext,
  ) =>
    | DistributedMapReaderPage<TItem, TState>
    | Promise<DistributedMapReaderPage<TItem, TState>>,
  opts?: {
    /**
     * Must match the item serdes the processor uses to read each record body.
     * Must produce a payload that can be deserialized without the original context.
     */
    itemSerdes?: Serdes<TItem>;
    /** Must produce a payload that can be deserialized without the original context. */
    stateSerdes?: Serdes<TState>;
  },
): (event: unknown, context: Context) => Promise<DistributedMapReaderResponse> {
  const itemSerdes = (opts?.itemSerdes ?? defaultSerdes) as AnySerdes;
  const serdes = (opts?.stateSerdes ?? defaultSerdes) as AnySerdes;
  return async (event: unknown): Promise<DistributedMapReaderResponse> => {
    assertReaderEvent(event);
    const runArn = event.distributedMapRunArn;
    const state =
      event.state !== undefined && event.state !== null
        ? ((await serdes.deserialize(
            event.state,
            dmapSerdesContext(runArn, "state", event.state),
          )) as TState)
        : undefined;

    const page = await fn(
      state,
      event.maxItemsPerPage,
      Object.freeze({ distributedMapRunArn: runArn }),
    );
    if (page.items.length > event.maxItemsPerPage) {
      throw new Error(
        `reader returned ${page.items.length} items, exceeding maxItemsPerPage ${event.maxItemsPerPage}`,
      );
    }

    const items: string[] = [];
    for (const [index, item] of page.items.entries()) {
      const serialized = await itemSerdes.serialize(
        item,
        dmapSerdesContext(runArn, "item", event.state, index),
      );
      if (typeof serialized !== "string") {
        throw new Error(`reader item ${index} serialized to no string`);
      }
      items.push(serialized);
    }
    const response: DistributedMapReaderResponse = { items };
    if (page.nextState !== undefined && page.nextState !== null) {
      const nextState = await serdes.serialize(
        page.nextState,
        dmapSerdesContext(runArn, "next-state", event.state),
      );
      if (typeof nextState !== "string") {
        throw new Error("reader nextState serialized to no string");
      }
      if (Buffer.byteLength(nextState, "utf8") > READER_STATE_LIMIT) {
        throw new Error("reader nextState exceeds the 32 KB limit");
      }
      // nextState becomes the next call's input state, so returning the input state repeats the same position.
      // The service rejects this as a source failure, with or without items.
      if (nextState === event.state) {
        throw new Error(
          "reader nextState must differ from the state it was called with, or the next page repeats the same position",
        );
      }
      response.nextState = nextState;
    }
    return response;
  };
}

/** Durable variant of the item handler, fn receives (context, item, itemContext). @public */
export function createDistributedMapItemHandlerWithDurableExecution<
  TItem,
  TOutput,
>(
  fn: (
    context: DurableContext,
    item: TItem,
    itemContext: DistributedMapItemContext,
  ) => TOutput | Promise<TOutput>,
  opts?: {
    itemSerdes?: Serdes<TItem>;
    resultSerdes?: Serdes<TOutput>;
    /** Children in flight at once. Defaults to 1, and must be an integer of 1 or more. */
    concurrency?: number;
    /** Passed to withDurableExecution, for example to register plugins or supply a client. */
    durableExecutionConfig?: DurableExecutionConfig;
  },
): DurableLambdaHandler {
  assertConcurrency(opts?.concurrency);
  const itemSerdes = (opts?.itemSerdes ?? defaultSerdes) as AnySerdes;
  const resultSerdes = (opts?.resultSerdes ?? defaultSerdes) as AnySerdes;
  const concurrency = opts?.concurrency ?? 1;

  return withDurableExecution(
    async (
      event: ProcessorEvent,
      context: DurableContext,
    ): Promise<DistributedMapItemHandlerResponse> => {
      assertProcessorEvent(event);
      const records = event.records;
      // Run every item to completion, so one failing item never cancels another that would succeed.
      // Serialize inside the child, so a serialization failure fails only that item.
      const batch = await context.map(
        records.map((r) => r.body),
        async (ctx, body, index) => {
          const runArn = event.distributedMapRunArn;
          // context.map calls this once per record, with that record's index.
          const itemId = (records[index] as ProcessorRecord).itemId;
          const value = await fn(
            ctx,
            (await toItem(
              itemSerdes,
              body,
              dmapSerdesContext(runArn, "body", itemId),
            )) as TItem,
            itemContextFor(event, itemId),
          );
          return await toOutput(
            resultSerdes,
            value,
            dmapSerdesContext(runArn, "output", itemId),
          );
        },
        {
          maxConcurrency: concurrency,
          completionConfig: { toleratedFailurePercentage: 100 },
        },
      );

      return toItemHandlerResponse(
        batch.all.map((item) => {
          // batch.all has one item per record, and item.index is that record's index.
          const itemId = (records[item.index] as ProcessorRecord).itemId;
          // Only SUCCEEDED yields an output. FAILED or non-terminal is a failure.
          return {
            itemId,
            outcome:
              item.status === BatchItemStatus.SUCCEEDED
                ? { ok: true, value: item.result }
                : {
                    ok: false,
                    error:
                      item.error ??
                      new Error(`item ${itemId} did not complete`),
                  },
          };
        }),
      );
    },
    opts?.durableExecutionConfig,
  );
}

/** Durable variant of the batch handler, fn receives (context, items, batchContext). @public */
export function createDistributedMapBatchHandlerWithDurableExecution<TItem>(
  fn: (
    context: DurableContext,
    items: TItem[],
    batchContext: DistributedMapBatchContext,
  ) => void | Promise<void>,
  opts?: {
    itemSerdes?: Serdes<TItem>;
    /** Passed to withDurableExecution, for example to register plugins or supply a client. */
    durableExecutionConfig?: DurableExecutionConfig;
  },
): DurableLambdaHandler {
  const serdes = (opts?.itemSerdes ?? defaultSerdes) as AnySerdes;
  return withDurableExecution(
    async (event: ProcessorEvent, context: DurableContext): Promise<void> => {
      assertProcessorEvent(event);
      const items = await decodeRecords<TItem>(serdes, event);
      await fn(context, items, batchContextFor(event));
    },
    opts?.durableExecutionConfig,
  );
}
