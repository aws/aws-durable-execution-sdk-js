import {
  type Serdes,
  type AnySerdes,
  type SerdesContext,
  defaultSerdes,
} from "./utils/serdes/serdes";
import {
  type DurableContext,
  type DurableLogger,
  BatchItemStatus,
  NestingType,
  type DistributedMapItemContext,
  type DistributedMapBatchContext,
  type DistributedMapReaderContext,
} from "./types";
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

/** One record in a processor event, the item identified by `itemId`. @public */
export interface DistributedMapProcessorRecord {
  itemId: string;
  /** The item as a serialized string, deserialized by the configured item serdes. */
  body: string;
}

/** The event the service sends to a processor Lambda. @public */
export interface DistributedMapProcessorEvent {
  distributedMapRunArn: string;
  records: DistributedMapProcessorRecord[];
}

/** The event the service sends to a reader Lambda. @public */
export interface DistributedMapReaderEvent {
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
  event: DistributedMapProcessorEvent,
  itemId: string,
): DistributedMapItemContext {
  return Object.freeze({
    distributedMapRunArn: event.distributedMapRunArn,
    itemId,
  });
}

function batchContextFor(
  event: DistributedMapProcessorEvent,
): DistributedMapBatchContext {
  return Object.freeze({
    distributedMapRunArn: event.distributedMapRunArn,
    itemIds: Object.freeze(event.records.map((r) => r.itemId)),
  });
}

/** Reject an event that is not a distributed map processor payload. */
function assertProcessorEvent(
  event: unknown,
): asserts event is DistributedMapProcessorEvent {
  const e = event as DistributedMapProcessorEvent | undefined;
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
function assertReaderEvent(
  event: unknown,
): asserts event is DistributedMapReaderEvent {
  const e = event as DistributedMapReaderEvent | undefined;
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
  event: DistributedMapProcessorEvent,
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

/** Where each failed item's ERROR log line goes, and the run ARN it carries. */
interface FailureLog {
  distributedMapRunArn: string;
  log: (entry: Record<string, unknown>) => void;
}

/**
 * Builds an item handler response. A succeeded item with no output is listed without one.
 * dmap writes one ERROR log line per failed item because a handler that only throws leaves no log line with the item ID.
 */
function toItemHandlerResponse(
  entries: Array<{ itemId: string; outcome: ItemOutcome<string | undefined> }>,
  failureLog: FailureLog,
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
      const error = {
        errorType: e.ErrorType,
        errorMessage: e.ErrorMessage,
        errorData: e.ErrorData,
        stackTrace: e.StackTrace,
      };
      failures.push({ itemIdentifier: itemId, error });
      // One object with a "message" key, so loggers that merge keys into the top level keep each field.
      // Absent error fields are left out of the log line.
      failureLog.log({
        message: "distributed map item failed",
        distributedMapRunArn: failureLog.distributedMapRunArn,
        itemId,
        ...Object.fromEntries(
          Object.entries(error).filter(([, v]) => v !== undefined),
        ),
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
 * Calls `fn` on each item in the batch, and returns each item's result or error in the format the
 * service expects. Call it in the handler of your processor Lambda, and pass that Lambda's name to
 * `DistributedMapProcessor.reportItemOutcomes` in the parent's `ctx.distributedMap` call.
 *
 * Note: your handler must return this function's result, because the service reads which items
 * failed from the handler's return value. If the handler returns nothing, the service marks every
 * item as succeeded.
 *
 * Each failed item also writes one ERROR log line with the run ARN, the item ID and the error.
 *
 * Items run one at a time by default. Raising `concurrency` overlaps calls to `fn` and to both
 * serdes, so they must tolerate several calls in flight at once.
 *
 * @example Non-durable handler
 * ```typescript
 * import {
 *   processDistributedMapItems,
 *   type DistributedMapProcessorEvent,
 * } from "@aws/durable-execution-sdk-js";
 *
 * export const handler = async (event: DistributedMapProcessorEvent) => {
 *   return processDistributedMapItems(
 *     event,
 *     async (order: Order, itemContext) => {
 *       console.log("processing", itemContext.itemId, itemContext.distributedMapRunArn);
 *       return await chargeOrder(order);
 *     },
 *     { concurrency: 5 },
 *   );
 * };
 * ```
 *
 * @public
 */
export function processDistributedMapItems<TItem, TOutput>(
  event: DistributedMapProcessorEvent,
  fn: (
    item: TItem,
    itemContext: DistributedMapItemContext,
  ) => TOutput | Promise<TOutput>,
  opts?: {
    itemSerdes?: Serdes<TItem>;
    resultSerdes?: Serdes<TOutput>;
    /** Maximum number of concurrent executions (default: 1). Must be an integer of 1 or more. */
    concurrency?: number;
  },
): Promise<DistributedMapItemHandlerResponse>;
/**
 * Calls `fn` on each item in the batch, and returns each item's result or error in the format the
 * service expects. Call it in the `withDurableExecution` handler of your durable processor Lambda,
 * and pass that Lambda's name to `DistributedMapProcessor.reportItemOutcomes` in the parent's
 * `ctx.distributedMap` call.
 *
 * Note: your handler must return this function's result, because the service reads which items
 * failed from the handler's return value. If the handler returns nothing, the service marks every
 * item as succeeded.
 *
 * Each failed item also writes one ERROR log line with the run ARN, the item ID and the error.
 *
 * Pass the handler's `DurableContext` first. Each item runs through `context.map`, with
 * `NestingType.FLAT` by default.
 *
 * @example Durable handler
 * ```typescript
 * import {
 *   processDistributedMapItems,
 *   withDurableExecution,
 *   type DistributedMapProcessorEvent,
 * } from "@aws/durable-execution-sdk-js";
 *
 * export const handler = withDurableExecution(
 *   async (event: DistributedMapProcessorEvent, ctx) => {
 *     return processDistributedMapItems(
 *       ctx,
 *       event,
 *       async (itemCtx, order: Order) => {
 *         return await itemCtx.step("charge", () => chargeOrder(order));
 *       },
 *       { concurrency: 5 },
 *     );
 *   },
 *   { plugins: [myPlugin] },
 * );
 * ```
 *
 * @public
 */
export function processDistributedMapItems<
  TItem,
  TOutput,
  Logger extends DurableLogger = DurableLogger,
>(
  context: DurableContext<Logger>,
  event: DistributedMapProcessorEvent,
  fn: (
    context: DurableContext<Logger>,
    item: TItem,
    itemContext: DistributedMapItemContext,
  ) => TOutput | Promise<TOutput>,
  opts?: {
    itemSerdes?: Serdes<TItem>;
    resultSerdes?: Serdes<TOutput>;
    /** Maximum number of concurrent executions (default: 1). Must be an integer of 1 or more. */
    concurrency?: number;
    /** Nesting type for map iterations (default: NestingType.FLAT) */
    nesting?: NestingType;
  },
): Promise<DistributedMapItemHandlerResponse>;
export async function processDistributedMapItems(
  eventOrContext: unknown,
  fnOrEvent: unknown,
  optsOrFn?: unknown,
  durableOpts?: unknown,
): Promise<DistributedMapItemHandlerResponse> {
  // A non-durable handler calls (event, fn), and a durable handler calls (context, event, fn).
  // So a function as the second argument means the call comes from a non-durable handler.
  if (typeof fnOrEvent === "function") {
    return processItemsNonDurable(
      eventOrContext,
      fnOrEvent as NonDurableItemFn,
      optsOrFn as ItemOpts | undefined,
    );
  }
  return processItemsDurable(
    eventOrContext as DurableContext,
    fnOrEvent,
    optsOrFn as DurableItemFn,
    durableOpts as (ItemOpts & { nesting?: NestingType }) | undefined,
  );
}

interface ItemOpts {
  itemSerdes?: Serdes<unknown>;
  resultSerdes?: Serdes<unknown>;
  concurrency?: number;
}

type NonDurableItemFn = (
  item: unknown,
  itemContext: DistributedMapItemContext,
) => unknown;

type DurableItemFn = (
  context: DurableContext,
  item: unknown,
  itemContext: DistributedMapItemContext,
) => unknown;

async function processItemsNonDurable(
  event: unknown,
  fn: NonDurableItemFn,
  opts?: ItemOpts,
): Promise<DistributedMapItemHandlerResponse> {
  assertConcurrency(opts?.concurrency);
  const itemSerdes = (opts?.itemSerdes ?? defaultSerdes) as AnySerdes;
  const resultSerdes = (opts?.resultSerdes ?? defaultSerdes) as AnySerdes;
  const concurrency = opts?.concurrency ?? 1;

  assertProcessorEvent(event);
  const records = event.records;
  // Serialize inside the worker, so a serialization failure fails only that item.
  const outcomes = await runPool(records, concurrency, async (record) => {
    const runArn = event.distributedMapRunArn;
    const value = await fn(
      await toItem(
        itemSerdes,
        record.body,
        dmapSerdesContext(runArn, "body", record.itemId),
      ),
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
    // The non-durable form has no durable logger, so dmap logs to the console.
    {
      distributedMapRunArn: event.distributedMapRunArn,
      // biome-ignore lint/suspicious/noConsole: a non-durable handler has no logger, so the line goes to the console.
      log: (entry) => console.error(entry),
    },
  );
}

async function processItemsDurable(
  context: DurableContext,
  event: unknown,
  fn: DurableItemFn,
  opts?: ItemOpts & { nesting?: NestingType },
): Promise<DistributedMapItemHandlerResponse> {
  assertConcurrency(opts?.concurrency);
  const itemSerdes = (opts?.itemSerdes ?? defaultSerdes) as AnySerdes;
  const resultSerdes = (opts?.resultSerdes ?? defaultSerdes) as AnySerdes;
  const concurrency = opts?.concurrency ?? 1;

  assertProcessorEvent(event);
  const records = event.records;
  // Run every item to completion, so one failing item never cancels another that would succeed.
  // Serialize inside the child, so a serialization failure fails only that item.
  const batch = await context.map(
    records.map((r) => r.body),
    async (ctx, body, index) => {
      const runArn = event.distributedMapRunArn;
      // context.map calls this once per record, with that record's index.
      const itemId = (records[index] as DistributedMapProcessorRecord).itemId;
      const value = await fn(
        ctx,
        await toItem(
          itemSerdes,
          body,
          dmapSerdesContext(runArn, "body", itemId),
        ),
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
      nesting: opts?.nesting ?? NestingType.FLAT,
      completionConfig: { toleratedFailurePercentage: 100 },
    },
  );

  return toItemHandlerResponse(
    batch.all.map((item) => {
      // batch.all has one item per record, and item.index is that record's index.
      const itemId = (records[item.index] as DistributedMapProcessorRecord)
        .itemId;
      // Only SUCCEEDED yields an output. FAILED or non-terminal is a failure.
      return {
        itemId,
        outcome:
          item.status === BatchItemStatus.SUCCEEDED
            ? { ok: true, value: item.result }
            : {
                ok: false,
                error:
                  item.error ?? new Error(`item ${itemId} did not complete`),
              },
      };
    }),
    // dmap logs through the handler's durable logger, so replay de-duplication applies.
    {
      distributedMapRunArn: event.distributedMapRunArn,
      log: (entry) => context.logger.error(entry),
    },
  );
}

/**
 * Calls `fn` once with all the items in the batch. Returning passes the batch, and throwing fails
 * it. Call it in the handler of your processor Lambda, and pass that Lambda's name to
 * `DistributedMapProcessor.reportBatchOutcome` in the parent's `ctx.distributedMap` call.
 *
 * Note: your handler must return or await this function's result, because the service reads a
 * batch failure from the handler's error. If the handler does neither, the service marks the batch
 * as succeeded even when `fn` fails.
 *
 * It works the same in a non-durable handler and in a `withDurableExecution` handler. In a durable
 * handler, use the handler's `ctx` inside `fn`. This helper does not pass it to `fn`.
 *
 * @example
 * ```typescript
 * import {
 *   processDistributedMapBatch,
 *   type DistributedMapProcessorEvent,
 * } from "@aws/durable-execution-sdk-js";
 *
 * export const handler = async (event: DistributedMapProcessorEvent) => {
 *   return processDistributedMapBatch(event, async (rows: Row[], batchContext) => {
 *     await writeRows(rows, batchContext.itemIds);
 *   });
 * };
 * ```
 *
 * @public
 */
export async function processDistributedMapBatch<TItem>(
  event: DistributedMapProcessorEvent,
  fn: (
    items: TItem[],
    batchContext: DistributedMapBatchContext,
  ) => void | Promise<void>,
  opts?: { itemSerdes?: Serdes<TItem> },
): Promise<void> {
  const serdes = (opts?.itemSerdes ?? defaultSerdes) as AnySerdes;
  assertProcessorEvent(event);
  const items = await decodeRecords<TItem>(serdes, event);
  await fn(items, batchContextFor(event));
}

/**
 * Calls `fn` to read one page of items, and returns the page in the format the service expects.
 * Call it in the handler of your reader Lambda, and pass that Lambda's name to
 * `DistributedMapSource.reader.fromFunction` in the parent's `ctx.distributedMap` call. A missing
 * `nextState` means the source has no more items.
 *
 * Note: your handler must return this function's result, because the service reads the page from
 * the handler's return value.
 *
 * @example
 * ```typescript
 * import {
 *   readDistributedMapPage,
 *   type DistributedMapReaderEvent,
 * } from "@aws/durable-execution-sdk-js";
 *
 * export const handler = async (event: DistributedMapReaderEvent) => {
 *   return readDistributedMapPage(
 *     event,
 *     async (cursor: string | undefined, maxItemsPerPage) => {
 *       const page = await listCustomers(cursor, maxItemsPerPage);
 *       return { items: page.customers, nextState: page.nextCursor };
 *     },
 *   );
 * };
 * ```
 *
 * @public
 */
export async function readDistributedMapPage<TItem, TState>(
  event: DistributedMapReaderEvent,
  fn: (
    state: TState | undefined,
    maxItemsPerPage: number,
    readerContext: DistributedMapReaderContext,
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
): Promise<DistributedMapReaderResponse> {
  const itemSerdes = (opts?.itemSerdes ?? defaultSerdes) as AnySerdes;
  const serdes = (opts?.stateSerdes ?? defaultSerdes) as AnySerdes;
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
}
