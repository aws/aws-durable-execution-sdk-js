import { vi, describe, it, expect, afterEach } from "vitest";
import {
  processDistributedMapItems,
  processDistributedMapBatch,
  readDistributedMapPage,
  DistributedMapItemHandlerResponse,
  DistributedMapProcessorEvent,
  DistributedMapReaderEvent,
} from "./distributed-map-helpers";
import {
  BatchItemStatus,
  DistributedMapBatchContext,
  DistributedMapItemContext,
  DistributedMapReaderContext,
  NestingType,
} from "./types";
import { DistributedMapError } from "./errors/durable-error/durable-error";
import { Serdes, SerdesContext } from "./utils/serdes/serdes";
import { dmapSerdesContext } from "./handlers/distributed-map-handler/distributed-map-serdes-context";

// Distinguishable serdes: input decode adds 1000, output encode adds 1, so a test
// can prove the item serdes ran on the input and the result serdes ran on the output.
const inputSerdes: Serdes<number> = {
  serialize: async (v) => JSON.stringify(v),
  deserialize: async (d) => (JSON.parse(d as string) as number) + 1000,
};
const outputSerdes: Serdes<number> = {
  serialize: async (v) => JSON.stringify((v as number) + 1),
  deserialize: async (d) => JSON.parse(d as string) as number,
};

const PARENT_ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:parent:$LATEST/durable-execution/e/i";
const RUN_ARN = `${PARENT_ARN}/distributed-map-run/run-1`;

const event = (
  records: Array<{ itemId: string; body: unknown }>,
): {
  distributedMapRunArn: string;
  records: Array<{ itemId: string; body: unknown }>;
} => ({
  distributedMapRunArn: RUN_ARN,
  records,
});

// Test shorthands. Each calls the real helper, so a test reads as handler(event) with the options
// under test. Non-durable and durable item helpers differ only in their leading arguments.
const ctx = undefined;

function nonDurableItems<TItem, TOutput>(
  fn: (
    item: TItem,
    itemContext: DistributedMapItemContext,
  ) => TOutput | Promise<TOutput>,
  opts?: {
    itemSerdes?: Serdes<TItem>;
    resultSerdes?: Serdes<TOutput>;
    concurrency?: number;
  },
) {
  return (event: unknown, _unused?: unknown) =>
    processDistributedMapItems<TItem, TOutput>(
      event as DistributedMapProcessorEvent,
      fn,
      opts,
    );
}

function durableItems<TItem, TOutput>(
  fn: (
    context: any,
    item: TItem,
    itemContext: DistributedMapItemContext,
  ) => TOutput | Promise<TOutput>,
  opts?: {
    itemSerdes?: Serdes<TItem>;
    resultSerdes?: Serdes<TOutput>;
    concurrency?: number;
    nesting?: NestingType;
  },
) {
  return (event: unknown, durableContext: any) =>
    processDistributedMapItems<TItem, TOutput>(
      durableContext,
      event as DistributedMapProcessorEvent,
      fn,
      opts,
    );
}

function nonDurableBatch<TItem>(
  fn: (
    items: TItem[],
    batchContext: DistributedMapBatchContext,
  ) => void | Promise<void>,
  opts?: { itemSerdes?: Serdes<TItem> },
) {
  return (event: unknown, _unused?: unknown) =>
    processDistributedMapBatch<TItem>(
      event as DistributedMapProcessorEvent,
      fn,
      opts,
    );
}

function nonDurableReader<TItem, TState>(
  fn: (
    state: TState | undefined,
    maxItemsPerPage: number,
    readerContext: DistributedMapReaderContext,
  ) => { items: TItem[]; nextState?: TState },
  opts?: { itemSerdes?: Serdes<TItem>; stateSerdes?: Serdes<TState> },
) {
  return (event: unknown, _unused?: unknown) =>
    readDistributedMapPage<TItem, TState>(
      event as DistributedMapReaderEvent,
      fn,
      opts,
    );
}

describe("processDistributedMapItems (non-durable) concurrency", () => {
  // Records the number of handlers in flight, so the default can be proven serial.
  const trackingHandler = (opts?: { concurrency?: number }) => {
    let inFlight = 0;
    let peak = 0;
    const handler = nonDurableItems<number, number>(async (item) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return item;
    }, opts);
    return { handler, peak: () => peak };
  };

  const fourRecords = event([
    { itemId: "0", body: "0" },
    { itemId: "1", body: "1" },
    { itemId: "2", body: "2" },
    { itemId: "3", body: "3" },
  ]);

  it("processes one item at a time by default", async () => {
    const { handler, peak } = trackingHandler();

    await handler(fourRecords, ctx);

    expect(peak()).toBe(1);
  });

  it("overlaps up to the configured concurrency", async () => {
    const { handler, peak } = trackingHandler({ concurrency: 3 });

    await handler(fourRecords, ctx);

    expect(peak()).toBe(3);
  });

  it("still accounts for every item when running serially", async () => {
    const { handler } = trackingHandler();

    const result = await handler(fourRecords, ctx);

    expect(result.batchItemResults).toHaveLength(4);
    expect(result.batchItemFailures).toEqual([]);
  });

  it.each([0, -1, 2.5])("rejects concurrency %p", async (concurrency) => {
    await expect(
      nonDurableItems<number, number>(async (i) => i, {
        concurrency,
      })(fourRecords),
    ).rejects.toThrow("concurrency must be an integer of 1 or more");
  });
});

describe("processDistributedMapItems (non-durable) serdes split", () => {
  it("decodes the input with itemSerdes and encodes the output with resultSerdes", async () => {
    const handler = nonDurableItems<number, number>((item) => item * 2, {
      itemSerdes: inputSerdes,
      resultSerdes: outputSerdes,
    });

    const res = await handler(event([{ itemId: "0", body: 2 }]), ctx);

    // 2 -> (+1000) 1002 -> (*2) 2004 -> (+1) 2005
    expect(res.batchItemResults).toEqual([
      { itemIdentifier: "0", output: "2005" },
    ]);
    expect(res.batchItemFailures).toEqual([]);
  });

  it("round-trips through the default serdes when none is supplied", async () => {
    const handler = nonDurableItems<number, number>((item) => item * 2);
    const res = await handler(event([{ itemId: "0", body: 21 }]), ctx);
    expect(res.batchItemResults).toEqual([
      { itemIdentifier: "0", output: "42" },
    ]);
  });

  it("sends a non-JSON resultSerdes output unchanged", async () => {
    const handler = nonDurableItems<number, number>((item) => item, {
      resultSerdes: {
        serialize: async () => "not json {",
        deserialize: async () => 0,
      },
    });
    const res = await handler(event([{ itemId: "0", body: 1 }]), ctx);
    expect(res.batchItemResults).toEqual([
      { itemIdentifier: "0", output: "not json {" },
    ]);
    expect(res.batchItemFailures).toEqual([]);
  });

  it("records a thrown item as a failure", async () => {
    const handler = nonDurableItems<number, number>(() => {
      throw new Error("boom");
    });
    const res = await handler(event([{ itemId: "7", body: 1 }]), ctx);
    expect(res.batchItemResults).toEqual([]);
    expect(res.batchItemFailures).toEqual([
      {
        itemIdentifier: "7",
        error: { errorType: "Error", errorMessage: "boom" },
      },
    ]);
  });

  it("reports a thrown error's errorData", async () => {
    const handler = nonDurableItems<number, number>(() => {
      throw new DistributedMapError("bad item", undefined, '{"id":7}');
    });
    const res = await handler(event([{ itemId: "7", body: 1 }]), ctx);
    expect(res.batchItemFailures[0].error).toEqual({
      errorType: "DistributedMapError",
      errorMessage: "bad item",
      errorData: '{"id":7}',
    });
  });

  it("does not report errorData set by hand on a plain Error", async () => {
    // createErrorObjectFromError reads errorData only from SDK errors, as other operations do.
    const handler = nonDurableItems<number, number>(() => {
      throw Object.assign(new Error("bad item"), { errorData: '{"id":7}' });
    });
    const res = await handler(event([{ itemId: "7", body: 1 }]), ctx);
    expect(res.batchItemFailures[0].error).toEqual({
      errorType: "Error",
      errorMessage: "bad item",
    });
    expect(res.batchItemFailures[0].error?.errorData).toBeUndefined();
  });

  it("reports both results and failures in one response", async () => {
    const handler = nonDurableItems<number, number>((item) => {
      if (item === 2) throw new Error("boom");
      return item;
    });
    const res = await handler(
      event([
        { itemId: "0", body: 1 },
        { itemId: "1", body: 2 },
      ]),
      ctx,
    );
    expect(res.batchItemResults).toEqual([
      { itemIdentifier: "0", output: "1" },
    ]);
    expect(res.batchItemFailures.map((f) => f.itemIdentifier)).toEqual(["1"]);
  });

  it("rejects an event that is not a processor payload", async () => {
    const handler = nonDurableItems<number, number>((i) => i);
    await expect(handler({} as any, ctx)).rejects.toThrow(/records/);
    await expect(handler(undefined as any, ctx)).rejects.toThrow(/records/);
  });
});

describe("processDistributedMapItems (non-durable) thrown non-error and empty output", () => {
  it("records an item that throws undefined as a failure, not a success", async () => {
    const handler = nonDurableItems<number, number>(() => {
      throw undefined;
    });
    const res = await handler(event([{ itemId: "3", body: 1 }]), ctx);
    expect(res.batchItemResults).toEqual([]);
    expect(res.batchItemFailures).toEqual([
      {
        itemIdentifier: "3",
        error: { errorMessage: "Unknown error" },
      },
    ]);
  });

  it("reports a thrown non-error object as an unknown error", async () => {
    const handler = nonDurableItems<number, number>(() => {
      throw { code: 42 };
    });
    const res = await handler(event([{ itemId: "3", body: 1 }]), ctx);
    expect(res.batchItemFailures).toEqual([
      {
        itemIdentifier: "3",
        error: { errorMessage: "Unknown error" },
      },
    ]);
  });

  it("rejects a record without a string itemId", async () => {
    const handler = nonDurableItems<number, number>((n) => n);
    await expect(
      handler(
        event([{ body: 1 } as unknown as { itemId: string; body: unknown }]),
        ctx,
      ),
    ).rejects.toThrow(/string 'itemId'/);
  });

  it("lists an item with no output when the fn returns undefined", async () => {
    const handler = nonDurableItems<number, number | undefined>(
      () => undefined,
    );
    const res = await handler(event([{ itemId: "0", body: 1 }]), ctx);
    expect(res.batchItemResults).toEqual([{ itemIdentifier: "0" }]);
    // toEqual ignores a key whose value is undefined, so check the key is absent.
    expect(res.batchItemResults[0]).not.toHaveProperty("output");
    expect(res.batchItemFailures).toEqual([]);
  });

  it('serializes a null return as the string "null"', async () => {
    const handler = nonDurableItems<number, number | null>(() => null);
    const res = await handler(event([{ itemId: "0", body: 1 }]), ctx);
    expect(res.batchItemResults).toEqual([
      { itemIdentifier: "0", output: "null" },
    ]);
    expect(res.batchItemFailures).toEqual([]);
  });
});

describe("processDistributedMapBatch", () => {
  it("decodes every record body with the input item serdes", async () => {
    const seen: number[] = [];
    const handler = nonDurableBatch<number>(
      (items) => {
        seen.push(...items);
      },
      { itemSerdes: inputSerdes },
    );
    await handler(
      event([
        { itemId: "0", body: 2 },
        { itemId: "1", body: 3 },
      ]),
      ctx,
    );
    expect(seen).toEqual([1002, 1003]);
  });

  it("rejects an event that is not a processor payload", async () => {
    const handler = nonDurableBatch<number>(() => {});
    await expect(handler({} as any, ctx)).rejects.toThrow(/records/);
  });
});

describe("readDistributedMapPage", () => {
  it("returns items and a serialized nextState", async () => {
    const reader = nonDurableReader<number, number>((state) => ({
      items: [1, 2],
      nextState: (state ?? 0) + 1,
    }));
    const res = await reader(
      { maxItemsPerPage: 10, distributedMapRunArn: RUN_ARN },
      ctx,
    );
    expect(res.items).toEqual(["1", "2"]);
    expect(res.nextState).toBeDefined();
  });

  it("serializes each item with a non-JSON itemSerdes", async () => {
    const reader = nonDurableReader<number, number>(() => ({ items: [1, 2] }), {
      itemSerdes: {
        serialize: async (v) => `item-${v}`,
        deserialize: async () => 0,
      },
    });
    const res = await reader(
      { maxItemsPerPage: 10, distributedMapRunArn: RUN_ARN },
      ctx,
    );
    expect(res.items).toEqual(["item-1", "item-2"]);
  });

  it("rejects a page that exceeds maxItemsPerPage", async () => {
    const reader = nonDurableReader<number, number>(() => ({
      items: [1, 2, 3],
    }));
    await expect(
      reader({ maxItemsPerPage: 2, distributedMapRunArn: RUN_ARN }, ctx),
    ).rejects.toThrow(/exceeding maxItemsPerPage/);
  });

  it("rejects an item or nextState that serializes to no string", async () => {
    const noString = {
      serialize: async (): Promise<string | undefined> => undefined,
      deserialize: async (): Promise<number> => 0,
    };
    const itemReader = nonDurableReader<number, number>(
      () => ({ items: [1] }),
      {
        itemSerdes: noString,
      },
    );
    await expect(
      itemReader({ maxItemsPerPage: 2, distributedMapRunArn: RUN_ARN }, ctx),
    ).rejects.toThrow(/reader item 0 serialized to no string/);
    const stateReader = nonDurableReader<number, number>(
      () => ({ items: [], nextState: 1 }),
      { stateSerdes: noString },
    );
    await expect(
      stateReader({ maxItemsPerPage: 2, distributedMapRunArn: RUN_ARN }, ctx),
    ).rejects.toThrow(/nextState serialized to no string/);
  });

  it("passes maxItemsPerPage to the reader function", async () => {
    const reader = nonDurableReader<number, number>(
      (_state, maxItemsPerPage) => ({
        items: Array.from({ length: maxItemsPerPage }, (_, i) => i),
      }),
    );
    const res = await reader(
      { maxItemsPerPage: 3, distributedMapRunArn: RUN_ARN },
      ctx,
    );
    expect(res.items).toEqual(["0", "1", "2"]);
  });

  it("rejects a nextState equal to the input state, with or without items", async () => {
    for (const items of [[1], []]) {
      const reader = nonDurableReader<number, number>((state) => ({
        items,
        nextState: state,
      }));
      await expect(
        reader(
          { maxItemsPerPage: 10, state: "5", distributedMapRunArn: RUN_ARN },
          ctx,
        ),
      ).rejects.toThrow(/nextState must differ from the state/);
    }
  });

  it("rejects an event that is not a reader payload", async () => {
    const reader = nonDurableReader<number, number>(() => ({
      items: [],
    }));
    await expect(reader({} as any, ctx)).rejects.toThrow(/maxItemsPerPage/);
  });
});

describe("processDistributedMapItems (non-durable) serialization failures", () => {
  it("fails only the item whose output cannot be serialized", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const handler = nonDurableItems<number, unknown>((item) =>
      item === 2 ? circular : item * 10,
    );
    const res = await handler(
      event([
        { itemId: "0", body: 1 },
        { itemId: "1", body: 2 },
        { itemId: "2", body: 3 },
      ]),
      ctx,
    );
    expect(res.batchItemResults).toEqual([
      { itemIdentifier: "0", output: "10" },
      { itemIdentifier: "2", output: "30" },
    ]);
    expect(res.batchItemFailures).toHaveLength(1);
    expect(res.batchItemFailures[0].itemIdentifier).toBe("1");
    expect(res.batchItemFailures[0].error?.errorType).toBe("TypeError");
  });
});

describe("processDistributedMapItems (durable)", () => {
  // A context whose map runs the mapper for each item and records a terminal
  // outcome, so the wrapper's result/failure assembly can be exercised directly.
  const durableCtx = {
    logger: { error: vi.fn() },
    map: async (
      items: unknown[],
      mapper: (ctx: unknown, item: unknown, index: number) => unknown,
    ) => {
      const all: Array<{
        index: number;
        status: BatchItemStatus;
        result?: unknown;
        error?: unknown;
      }> = [];
      for (let i = 0; i < items.length; i++) {
        try {
          const result = await mapper(durableCtx, items[i], i);
          all.push({ index: i, status: BatchItemStatus.SUCCEEDED, result });
        } catch (error) {
          all.push({ index: i, status: BatchItemStatus.FAILED, error });
        }
      }
      return { all };
    },
  } as any;

  it("reports per-item results from the durable item handler", async () => {
    const handler = durableItems<number, number>((_ctx, item) => item * 2);
    const res = (await handler(
      event([
        { itemId: "0", body: 2 },
        { itemId: "1", body: 3 },
      ]) as any,
      durableCtx,
    )) as any;
    expect(res.batchItemResults).toEqual([
      { itemIdentifier: "0", output: "4" },
      { itemIdentifier: "1", output: "6" },
    ]);
    expect(res.batchItemFailures).toEqual([]);
  });

  it("lists an item with no output when the durable fn returns undefined", async () => {
    const handler = durableItems<number, number | undefined>((_ctx, item) =>
      item === 2 ? undefined : item,
    );
    const res = (await handler(
      event([
        { itemId: "0", body: 1 },
        { itemId: "1", body: 2 },
      ]) as any,
      durableCtx,
    )) as any;
    expect(res.batchItemResults).toEqual([
      { itemIdentifier: "0", output: "1" },
      { itemIdentifier: "1" },
    ]);
    // toEqual ignores a key whose value is undefined, so check the key is absent.
    expect(res.batchItemResults[1]).not.toHaveProperty("output");
    expect(res.batchItemFailures).toEqual([]);
  });

  it("captures a failed item while succeeding the rest", async () => {
    const handler = durableItems<number, number>((_ctx, item) => {
      if (item === 2) throw new Error("boom");
      return item * 2;
    });
    const res = (await handler(
      event([
        { itemId: "0", body: 1 },
        { itemId: "1", body: 2 },
      ]) as any,
      durableCtx,
    )) as any;
    expect(res.batchItemResults).toEqual([
      { itemIdentifier: "0", output: "2" },
    ]);
    expect(res.batchItemFailures).toEqual([
      {
        itemIdentifier: "1",
        error: { errorType: "Error", errorMessage: "boom" },
      },
    ]);
  });

  it("fails only the item whose output cannot be serialized in the durable item handler", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const handler = durableItems<number, unknown>((_ctx, item) =>
      item === 2 ? circular : item * 10,
    );
    const res = (await handler(
      event([
        { itemId: "0", body: 1 },
        { itemId: "1", body: 2 },
        { itemId: "2", body: 3 },
      ]) as any,
      durableCtx,
    )) as any;
    expect(res.batchItemResults).toEqual([
      { itemIdentifier: "0", output: "10" },
      { itemIdentifier: "2", output: "30" },
    ]);
    expect(res.batchItemFailures).toHaveLength(1);
    expect(res.batchItemFailures[0].itemIdentifier).toBe("1");
  });

  it.each([
    [undefined, 1],
    [4, 4],
  ])(
    "passes concurrency %p to context.map as maxConcurrency %p",
    async (concurrency, expected) => {
      const map = vi.fn(async () => ({ all: [] }));
      const handler = durableItems<number, number>((_ctx, item) => item, {
        concurrency,
      });
      await handler(event([{ itemId: "0", body: 1 }]) as any, { map } as any);
      expect(map).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ maxConcurrency: expected }),
      );
    },
  );

  it.each([0, -1, 1.5])(
    "rejects durable item handler concurrency %p",
    async (concurrency) => {
      await expect(
        durableItems<number, number>((_ctx, item) => item, { concurrency })(
          event([{ itemId: "0", body: 1 }]),
          durableCtx,
        ),
      ).rejects.toThrow("concurrency must be an integer of 1 or more");
    },
  );

  it("passes nesting FLAT to context.map by default and the chosen nesting when given", async () => {
    const map = vi.fn(async () => ({ all: [] }));
    const records = event([{ itemId: "0", body: 1 }]);
    await durableItems<number, number>((_ctx, item) => item)(records, {
      map,
    });
    await durableItems<number, number>((_ctx, item) => item, {
      nesting: NestingType.NESTED,
    })(records, { map });
    expect(map.mock.calls.map((c) => (c as any)[2].nesting)).toEqual([
      NestingType.FLAT,
      NestingType.NESTED,
    ]);
  });

  it("selects the non-durable form when the second argument is a function", async () => {
    const map = vi.fn();
    const nonDurable = await processDistributedMapItems<number, number>(
      event([{ itemId: "0", body: 4 }]) as DistributedMapProcessorEvent,
      (item) => item * 2,
    );
    expect(nonDurable.batchItemResults).toEqual([
      { itemIdentifier: "0", output: "8" },
    ]);
    expect(map).not.toHaveBeenCalled();
  });

  it("selects the durable form when the first argument is a DurableContext", async () => {
    const map = vi.fn(async () => ({ all: [] }));
    await processDistributedMapItems<number, number>(
      { map } as any,
      event([{ itemId: "0", body: 4 }]) as DistributedMapProcessorEvent,
      (_ctx, item) => item,
    );
    expect(map).toHaveBeenCalledTimes(1);
  });
});

describe("processDistributedMapItems failed item log line", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("./utils/constants/constants");
    vi.resetModules();
  });

  // The SDK stores stack traces only when STORE_STACK_TRACES is true, so the test turns it on and reloads the helpers.
  async function helpersWithStackTraces() {
    vi.resetModules();
    vi.doMock("./utils/constants/constants", async (importOriginal) => ({
      ...(await importOriginal<object>()),
      STORE_STACK_TRACES: true,
    }));
    return await import("./distributed-map-helpers");
  }

  const twoItems = event([
    { itemId: "a", body: 1 },
    { itemId: "b", body: 2 },
  ]);

  const mapStub = (logger: { error: unknown }) =>
    ({
      logger,
      map: async (
        items: unknown[],
        mapper: (ctx: unknown, item: unknown, index: number) => unknown,
      ) => {
        const all = [];
        for (let i = 0; i < items.length; i++) {
          try {
            const result = await mapper(undefined, items[i], i);
            all.push({ index: i, status: BatchItemStatus.SUCCEEDED, result });
          } catch (error) {
            all.push({ index: i, status: BatchItemStatus.FAILED, error });
          }
        }
        return { all };
      },
    }) as any;

  it("non-durable: logs one ERROR line for the failed item only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await nonDurableItems<number, number>((n) => {
      if (n === 2) throw new Error("boom");
      return n;
    })(twoItems, ctx);
    const reported = res.batchItemFailures[0].error;
    expect(spy).toHaveBeenCalledTimes(1);
    const entry = spy.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      message: "distributed map item failed",
      distributedMapRunArn: RUN_ARN,
      itemId: "b",
      errorType: reported?.errorType,
      errorMessage: reported?.errorMessage,
    });
    expect(entry).not.toHaveProperty("errorData");
    expect(entry).not.toHaveProperty("stackTrace");
  });

  it("non-durable: logs errorData and stackTrace as reported", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const helpers = await helpersWithStackTraces();
    const { DistributedMapError: Err } = await import(
      "./errors/durable-error/durable-error"
    );
    const res = await helpers.processDistributedMapItems<number, number>(
      event([{ itemId: "a", body: 1 }]) as DistributedMapProcessorEvent,
      () => {
        throw new Err("bad item", new Error("cause"), '{"id":7}');
      },
    );
    const reported = res.batchItemFailures[0].error;
    const entry = spy.mock.calls[0][0] as Record<string, unknown>;
    expect(reported?.errorData).toBe('{"id":7}');
    expect(reported?.stackTrace?.length).toBeGreaterThan(0);
    expect(entry.errorData).toBe(reported?.errorData);
    expect(entry.stackTrace).toEqual(reported?.stackTrace);
  });

  it("non-durable: logs nothing when every item succeeds", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await nonDurableItems<number, number>((n) => n)(twoItems, ctx);
    expect(spy).not.toHaveBeenCalled();
  });

  it("durable: logs one ERROR line for the failed item only", async () => {
    const error = vi.fn();
    const res = (await durableItems<number, number>((_c, n) => {
      if (n === 2) throw new Error("boom");
      return n;
    })(twoItems, mapStub({ error }))) as any;
    const reported = res.batchItemFailures[0].error;
    expect(error).toHaveBeenCalledTimes(1);
    const entry = error.mock.calls[0][0] as Record<string, unknown>;
    expect(error.mock.calls[0]).toHaveLength(1);
    expect(entry).toMatchObject({
      message: "distributed map item failed",
      distributedMapRunArn: RUN_ARN,
      itemId: "b",
      errorType: reported.errorType,
      errorMessage: reported.errorMessage,
    });
    expect(entry).not.toHaveProperty("errorData");
    expect(entry).not.toHaveProperty("stackTrace");
  });

  it("durable: logs errorData and stackTrace as reported", async () => {
    const error = vi.fn();
    const helpers = await helpersWithStackTraces();
    const { DistributedMapError: Err } = await import(
      "./errors/durable-error/durable-error"
    );
    const res = (await helpers.processDistributedMapItems<number, number>(
      mapStub({ error }),
      event([{ itemId: "a", body: 1 }]) as DistributedMapProcessorEvent,
      () => {
        throw new Err("bad item", new Error("cause"), '{"id":7}');
      },
    )) as any;
    const reported = res.batchItemFailures[0].error;
    const entry = error.mock.calls[0][0] as Record<string, unknown>;
    expect(reported.errorData).toBe('{"id":7}');
    expect(reported.stackTrace.length).toBeGreaterThan(0);
    expect(entry.errorData).toBe(reported.errorData);
    expect(entry.stackTrace).toEqual(reported.stackTrace);
  });

  it("durable: logs nothing when every item succeeds", async () => {
    const error = vi.fn();
    await durableItems<number, number>((_c, n) => n)(
      twoItems,
      mapStub({ error }),
    );
    expect(error).not.toHaveBeenCalled();
  });
});

describe("processDistributedMapBatch fn handling", () => {
  it("passes every decoded item to fn", async () => {
    const seen: number[] = [];
    await nonDurableBatch<number>((items) => {
      seen.push(...items);
    })(
      event([
        { itemId: "0", body: 5 },
        { itemId: "1", body: 6 },
      ]),
    );
    expect(seen).toEqual([5, 6]);
  });

  it("rejects when fn throws, so the batch fails", async () => {
    await expect(
      nonDurableBatch<number>(() => {
        throw new Error("write failed");
      })(event([{ itemId: "0", body: 1 }])),
    ).rejects.toThrow("write failed");
  });
});

describe("Distributed map item handler response compile-time checks", () => {
  it("type-checks a failure listed without error details", () => {
    // The service accepts a failure with no error, so the type allows one.
    const response: DistributedMapItemHandlerResponse = {
      batchItemResults: [],
      batchItemFailures: [{ itemIdentifier: "x" }],
    };
    expect(response.batchItemFailures[0].error).toBeUndefined();
  });
});

// A JSON serdes that records the context of every call, keyed by the call's role.
function recordingSerdes<T>(): {
  serdes: Serdes<T>;
  serialized: SerdesContext[];
  deserialized: SerdesContext[];
} {
  const serialized: SerdesContext[] = [];
  const deserialized: SerdesContext[] = [];
  return {
    serialized,
    deserialized,
    serdes: {
      serialize: async (value, context): Promise<string> => {
        serialized.push(context);
        return JSON.stringify(value);
      },
      deserialize: async (data, context): Promise<T> => {
        deserialized.push(context);
        return JSON.parse(data as string) as T;
      },
    },
  };
}

// A context whose map runs the mapper for each item and reports a terminal outcome.
const runningDurableCtx = {
  map: async (
    items: unknown[],
    mapper: (ctx: unknown, item: unknown, index: number) => unknown,
  ) => {
    const all: Array<{
      index: number;
      status: BatchItemStatus;
      result?: unknown;
      error?: unknown;
    }> = [];
    for (let i = 0; i < items.length; i++) {
      try {
        const result = await mapper(runningDurableCtx, items[i], i);
        all.push({ index: i, status: BatchItemStatus.SUCCEEDED, result });
      } catch (error) {
        all.push({ index: i, status: BatchItemStatus.FAILED, error });
      }
    }
    return { all };
  },
} as any;

const twoRecords = event([
  { itemId: "item-a", body: "1" },
  { itemId: "item-b", body: "2" },
]);

describe("distributed map serdes contexts", () => {
  it("gives the item handler a distinct body and output context per item", async () => {
    const item = recordingSerdes<number>();
    const result = recordingSerdes<number>();
    const handler = nonDurableItems<number, number>((n) => n, {
      itemSerdes: item.serdes,
      resultSerdes: result.serdes,
    });

    await handler(twoRecords, ctx);

    expect(item.deserialized).toEqual([
      dmapSerdesContext(RUN_ARN, "body", "item-a"),
      dmapSerdesContext(RUN_ARN, "body", "item-b"),
    ]);
    expect(result.serialized).toEqual([
      dmapSerdesContext(RUN_ARN, "output", "item-a"),
      dmapSerdesContext(RUN_ARN, "output", "item-b"),
    ]);
    const ids = [...item.deserialized, ...result.serialized].map(
      (c) => c.entityId,
    );
    expect(new Set(ids).size).toBe(4);
    expect(item.deserialized[0].durableExecutionArn).toBe(PARENT_ARN);
  });

  it("gives the durable item handler the same body and output contexts", async () => {
    const item = recordingSerdes<number>();
    const result = recordingSerdes<number>();
    const handler = durableItems<number, number>((_c, n) => n, {
      itemSerdes: item.serdes,
      resultSerdes: result.serdes,
    });

    await handler(twoRecords as any, runningDurableCtx);

    expect(item.deserialized).toEqual([
      dmapSerdesContext(RUN_ARN, "body", "item-a"),
      dmapSerdesContext(RUN_ARN, "body", "item-b"),
    ]);
    expect(result.serialized).toEqual([
      dmapSerdesContext(RUN_ARN, "output", "item-a"),
      dmapSerdesContext(RUN_ARN, "output", "item-b"),
    ]);
  });

  it("gives the batch handlers a body context per item", async () => {
    const nonDurable = recordingSerdes<number>();
    await nonDurableBatch<number>(() => {}, {
      itemSerdes: nonDurable.serdes,
    })(twoRecords, ctx);

    expect(nonDurable.deserialized).toEqual([
      dmapSerdesContext(RUN_ARN, "body", "item-a"),
      dmapSerdesContext(RUN_ARN, "body", "item-b"),
    ]);
  });

  it("gives the reader distinct state, item and next-state contexts", async () => {
    const item = recordingSerdes<number>();
    const state = recordingSerdes<number>();
    const reader = nonDurableReader<number, number>(
      (s) => ({ items: [10, 20], nextState: (s ?? 0) + 1 }),
      { itemSerdes: item.serdes, stateSerdes: state.serdes },
    );

    await reader(
      { maxItemsPerPage: 5, state: "4", distributedMapRunArn: RUN_ARN },
      ctx,
    );

    expect(state.deserialized).toEqual([
      dmapSerdesContext(RUN_ARN, "state", "4"),
    ]);
    expect(item.serialized).toEqual([
      dmapSerdesContext(RUN_ARN, "item", "4", 0),
      dmapSerdesContext(RUN_ARN, "item", "4", 1),
    ]);
    expect(state.serialized).toEqual([
      dmapSerdesContext(RUN_ARN, "next-state", "4"),
    ]);
    const ids = [
      ...state.deserialized,
      ...item.serialized,
      ...state.serialized,
    ].map((c) => c.entityId);
    expect(new Set(ids).size).toBe(4);
  });
});

describe("distributed map customer function contexts", () => {
  const badArnEvents: Array<[string, Record<string, unknown>]> = [
    ["a missing", {}],
    ["a malformed", { distributedMapRunArn: "arn:not-a-run" }],
  ];

  it.each(badArnEvents)(
    "rejects a processor event with %s run ARN",
    async (_label, arn) => {
      const records = [{ itemId: "item-a", body: "1" }];
      const handlers = [
        nonDurableItems<number, number>((n) => n),
        nonDurableBatch<number>(() => {}),
      ];
      for (const handler of handlers) {
        await expect(handler({ records, ...arn }, ctx)).rejects.toThrow(
          /valid 'distributedMapRunArn'/,
        );
      }
      await expect(
        durableItems<number, number>((_c, n) => n)(
          { records, ...arn },
          runningDurableCtx,
        ),
      ).rejects.toThrow(/valid 'distributedMapRunArn'/);
    },
  );

  it.each(badArnEvents)(
    "rejects a reader event with %s run ARN",
    async (_label, arn) => {
      const reader = nonDurableReader<number, number>(() => ({
        items: [],
      }));
      await expect(reader({ maxItemsPerPage: 1, ...arn }, ctx)).rejects.toThrow(
        /valid 'distributedMapRunArn'/,
      );
    },
  );

  it("rejects a record with an empty itemId", async () => {
    const handler = nonDurableItems<number, number>((n) => n);
    await expect(
      handler(event([{ itemId: "", body: "1" }]), ctx),
    ).rejects.toThrow(/non-empty string 'itemId'/);
  });

  it("passes each item its own itemId and the run ARN", async () => {
    const seen: unknown[] = [];
    await nonDurableItems<number, number>((n, itemContext) => {
      seen.push(itemContext);
      return n;
    })(twoRecords, ctx);
    const seenDurable: unknown[] = [];
    await durableItems<number, number>((_c, n, itemContext) => {
      seenDurable.push(itemContext);
      return n;
    })(twoRecords as any, runningDurableCtx);

    const expected = [
      { distributedMapRunArn: RUN_ARN, itemId: "item-a" },
      { distributedMapRunArn: RUN_ARN, itemId: "item-b" },
    ];
    expect(seen).toEqual(expected);
    expect(seenDurable).toEqual(expected);
    expect([...seen, ...seenDurable].every((c) => Object.isFrozen(c))).toBe(
      true,
    );
  });

  it("passes the batch itemIds in the same order as the items", async () => {
    const records = event([
      { itemId: "item-c", body: "3" },
      { itemId: "item-a", body: "1" },
      { itemId: "item-b", body: "2" },
    ]);
    const seen: Array<[number[], unknown]> = [];
    await nonDurableBatch<number>((items, batchContext) => {
      expect(Object.isFrozen(batchContext)).toBe(true);
      expect(Object.isFrozen(batchContext.itemIds)).toBe(true);
      seen.push([items, batchContext]);
    })(records, ctx);

    const expected: [number[], unknown] = [
      [3, 1, 2],
      {
        distributedMapRunArn: RUN_ARN,
        itemIds: ["item-c", "item-a", "item-b"],
      },
    ];
    expect(seen).toEqual([expected]);
  });

  it("passes the reader the run ARN", async () => {
    let seen: unknown;
    const reader = nonDurableReader<number, number>(
      (_state, _max, readerContext) => {
        expect(Object.isFrozen(readerContext)).toBe(true);
        seen = readerContext;
        return { items: [] };
      },
    );

    await reader({ maxItemsPerPage: 1, distributedMapRunArn: RUN_ARN }, ctx);

    expect(seen).toEqual({ distributedMapRunArn: RUN_ARN });
  });
});
