import { createPluginRunner } from "./plugin-runner";
import type {
  DurableInstrumentationPlugin,
  PropagationInput,
  PropagationMetadata,
} from "../../types/plugin";

const input: PropagationInput = {
  executionArn: "arn:execution:one",
  operationId: "invoke-one",
  parentOperationId: "context-one",
  targetFunctionName: "callee:1",
};

describe("propagation metadata collector", () => {
  let warning: jest.SpyInstance;
  beforeEach(() => {
    warning = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warning.mockRestore();
  });
  const collect = (plugins: DurableInstrumentationPlugin[]) =>
    createPluginRunner(plugins).providePropagationMetadata?.(input);

  it("keeps existing plugins source compatible and supports no-op hooks", () => {
    const existing: DurableInstrumentationPlugin = {
      async onInvocationStart() {},
    };
    expect(collect([])).toBeUndefined();
    expect(
      collect([existing, { providePropagationMetadata: () => undefined }]),
    ).toEqual({});
    expect(warning).not.toHaveBeenCalled();
  });

  it("provides a frozen snapshot without freezing or mutating the caller's input", () => {
    const observed: PropagationInput[] = [];
    const result = collect([
      {
        providePropagationMetadata(info) {
          observed.push(info);
          // A misbehaving plugin cannot redirect later providers to another execution.
          (info as { executionArn: string }).executionArn = "wrong-execution";
          return { xAmznTraceId: "wrong" };
        },
      },
      {
        providePropagationMetadata(info) {
          observed.push(info);
          return { xAmznTraceId: "healthy" };
        },
      },
    ]);
    expect(observed[0]).toBe(observed[1]);
    expect(observed[1]).toEqual(input);
    expect(observed[0]).not.toBe(input);
    expect(Object.isFrozen(observed[0])).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(result).toEqual({ xAmznTraceId: "healthy" });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("collects in configured order, keeps the first value, and counts unequal conflicts", () => {
    class First {
      providePropagationMetadata() {
        return { xAmznTraceId: "first" };
      }
    }
    class Second {
      providePropagationMetadata() {
        return { xAmznTraceId: "second" };
      }
    }
    class Third {
      providePropagationMetadata() {
        return { xAmznTraceId: "third" };
      }
    }
    expect(
      collect([new First(), new First(), new Second(), new Third()]),
    ).toEqual({ xAmznTraceId: "first" });
    expect(warning).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenNthCalledWith(1, expect.any(String), {
      field: "xAmznTraceId",
      firstPlugin: "First (plugins[0])",
      laterPlugin: "Second (plugins[2])",
      conflictCount: 1,
    });
    expect(warning).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        laterPlugin: "Third (plugins[3])",
        conflictCount: 2,
      }),
    );
    expect(collect([new Second(), new First()])).toEqual({
      xAmznTraceId: "second",
    });
  });

  it("merges only supported members and treats null/undefined/blank as absent", () => {
    const result = collect([
      {
        providePropagationMetadata: () =>
          ({ xAmznTraceId: null }) as unknown as PropagationMetadata,
      },
      {
        providePropagationMetadata: () =>
          ({ baggage: "ignored" }) as PropagationMetadata,
      },
      {
        providePropagationMetadata: () => ({
          xAmznTraceId: "",
          baggage: "ignored",
        }),
      },
      { providePropagationMetadata: () => ({ xAmznTraceId: " \t\n" }) },
      { providePropagationMetadata: () => ({ xAmznTraceId: "later" }) },
    ]);
    expect(result).toEqual({ xAmznTraceId: "later" });
    expect(warning).not.toHaveBeenCalled();
  });

  it.each([
    42,
    "invalid",
    [],
    { xAmznTraceId: 42 },
    Object.defineProperty({}, "xAmznTraceId", {
      get() {
        throw new Error("getter");
      },
    }),
    // biome-ignore lint/suspicious/noThenProperty: deliberately hostile thenable getter tests plugin failure isolation.
    Object.defineProperty({}, "then", {
      get() {
        throw new Error("then getter");
      },
    }),
  ])(
    "ignores invalid results without skipping healthy providers: %p",
    (invalid) => {
      expect(
        collect([
          { providePropagationMetadata: () => invalid as PropagationMetadata },
          { providePropagationMetadata: () => ({ xAmznTraceId: "healthy" }) },
        ]),
      ).toEqual({ xAmznTraceId: "healthy" });
      expect(warning).toHaveBeenCalledTimes(1);
    },
  );

  it("isolates throwing hooks, hook getters, constructor getters, and diagnostics", async () => {
    const hookGetter = Object.defineProperty({}, "providePropagationMetadata", {
      get() {
        throw new Error("hook getter");
      },
    });
    const identityGetter = Object.defineProperty(
      {
        providePropagationMetadata() {
          throw new Error("hook");
        },
      },
      "constructor",
      {
        get() {
          throw new Error("identity getter");
        },
      },
    );
    warning.mockImplementation(() => {
      throw new Error("diagnostic");
    });
    const onInvocationStart = jest.fn(async () => undefined);
    const runner = createPluginRunner([
      hookGetter,
      identityGetter,
      {
        providePropagationMetadata: () => {
          throw new Error("hook");
        },
      },
      {
        providePropagationMetadata: () => ({ xAmznTraceId: "healthy" }),
        onInvocationStart,
      },
    ]);
    expect(runner.providePropagationMetadata?.(input)).toEqual({
      xAmznTraceId: "healthy",
    });
    await runner.onInvocationStart?.({
      requestId: "req",
      executionArn: input.executionArn,
      executionInput: {},
      isFirstInvocation: true,
      operations: {},
      updatedOperations: {},
    });
    expect(onInvocationStart).toHaveBeenCalledTimes(1);
  });

  it("ignores async results and contains rejected promises", async () => {
    expect(
      collect([
        {
          providePropagationMetadata: (() =>
            Promise.reject(
              new Error("async failure"),
            )) as unknown as DurableInstrumentationPlugin["providePropagationMetadata"],
        },
        {
          providePropagationMetadata: (() =>
            Promise.resolve({
              xAmznTraceId: "async",
            })) as unknown as DurableInstrumentationPlugin["providePropagationMetadata"],
        },
        { providePropagationMetadata: () => ({ xAmznTraceId: "healthy" }) },
      ]),
    ).toEqual({ xAmznTraceId: "healthy" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(warning).toHaveBeenCalledTimes(2);
  });

  it("isolates a non-callable hook without changing the handler result", async () => {
    const runner = createPluginRunner([
      {
        providePropagationMetadata: 42,
      } as unknown as DurableInstrumentationPlugin,
      { providePropagationMetadata: () => ({ xAmznTraceId: "healthy" }) },
    ]);
    expect(runner.providePropagationMetadata?.(input)).toEqual({
      xAmznTraceId: "healthy",
    });
    const expected = { Status: "SUCCEEDED", Result: '"ok"' } as const;
    const handler = jest.fn(async () => expected);
    // Metadata collection is independent of normal wrapper dispatch.
    const result = await runner.wrapChildContextFn?.(
      { id: "context", type: "CONTEXT", isReplay: false },
      handler,
    );
    expect(result).toBe(expected);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("keeps plugin method receiver binding and snapshots returned values", () => {
    const metadata = { xAmznTraceId: "before" };
    const plugin = {
      metadata,
      providePropagationMetadata() {
        return this.metadata;
      },
    };
    const result = collect([plugin]);
    metadata.xAmznTraceId = "after";
    expect(result).toEqual({ xAmznTraceId: "before" });
  });
});
