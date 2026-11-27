// Type-level tests for the distributed map helper functions.
//
// `tsc --noEmit` (`npm run typecheck`) checks this file. Vitest does not run
// it: nothing here executes, and the declared values exist only as types.
// A failing `expectTypeOf` or an unused `@ts-expect-error` fails the typecheck.

import { expectTypeOf } from "vitest";
import {
  processDistributedMapBatch,
  processDistributedMapItems,
  readDistributedMapPage,
  type DistributedMapItemHandlerResponse,
  type DistributedMapProcessorEvent,
  type DistributedMapProcessorRecord,
  type DistributedMapReaderEvent,
  type DistributedMapReaderResponse,
} from "./distributed-map-helpers";
import type {
  DistributedMapBatchContext,
  DistributedMapItemContext,
  DurableContext,
  DurableLogger,
  NestingType,
} from "./types";

declare const event: DistributedMapProcessorEvent;
declare const readerEvent: DistributedMapReaderEvent;
declare const nesting: NestingType;

interface Order {
  id: string;
}

interface AppLogger extends DurableLogger {
  audit(message: string): void;
}

declare const appCtx: DurableContext<AppLogger>;

// processDistributedMapItems, non-durable form

expectTypeOf(
  processDistributedMapItems(event, async (order: Order, itemContext) => {
    expectTypeOf(order).toEqualTypeOf<Order>();
    expectTypeOf(itemContext).toEqualTypeOf<DistributedMapItemContext>();
    return order.id;
  }),
).toEqualTypeOf<Promise<DistributedMapItemHandlerResponse>>();

void processDistributedMapItems(event, async (order: Order) => order.id, {
  concurrency: 2,
});

// @ts-expect-error The non-durable form does not accept nesting.
void processDistributedMapItems(event, async (order: Order) => order.id, {
  nesting,
});

// processDistributedMapItems, durable form

expectTypeOf(
  processDistributedMapItems(
    appCtx,
    event,
    async (itemCtx, order: Order, itemContext) => {
      expectTypeOf(itemCtx).toEqualTypeOf<DurableContext<AppLogger>>();
      expectTypeOf(order).toEqualTypeOf<Order>();
      expectTypeOf(itemContext).toEqualTypeOf<DistributedMapItemContext>();
      return order.id;
    },
    { nesting },
  ),
).toEqualTypeOf<Promise<DistributedMapItemHandlerResponse>>();

// processDistributedMapBatch

expectTypeOf(
  processDistributedMapBatch(event, async (orders: Order[], batchContext) => {
    expectTypeOf(orders).toEqualTypeOf<Order[]>();
    expectTypeOf(batchContext).toEqualTypeOf<DistributedMapBatchContext>();
  }),
).toEqualTypeOf<Promise<void>>();

// readDistributedMapPage

expectTypeOf(
  readDistributedMapPage(
    readerEvent,
    async (cursor: string | undefined, maxItemsPerPage) => {
      expectTypeOf(maxItemsPerPage).toBeNumber();
      return { items: [cursor ?? ""], nextState: "next" };
    },
  ),
).toEqualTypeOf<Promise<DistributedMapReaderResponse>>();

// Event types

expectTypeOf<DistributedMapProcessorRecord>().toEqualTypeOf<{
  itemId: string;
  body: string;
}>();
expectTypeOf<DistributedMapProcessorEvent>().toEqualTypeOf<{
  distributedMapRunArn: string;
  records: DistributedMapProcessorRecord[];
}>();
expectTypeOf<DistributedMapReaderEvent>().toEqualTypeOf<{
  distributedMapRunArn: string;
  state?: string | null;
  maxItemsPerPage: number;
}>();

// The helpers' event parameter has the matching event type.

expectTypeOf(processDistributedMapBatch<Order>)
  .parameter(0)
  .toEqualTypeOf<DistributedMapProcessorEvent>();
expectTypeOf(readDistributedMapPage<Order, string>)
  .parameter(0)
  .toEqualTypeOf<DistributedMapReaderEvent>();

// @ts-expect-error A reader event is not a processor event.
void processDistributedMapBatch(readerEvent, async () => {});

// @ts-expect-error A processor event is not a reader event.
void readDistributedMapPage(event, async () => ({ items: [] }));
