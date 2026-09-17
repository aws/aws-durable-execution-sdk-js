import {
  DurableInstrumentationPlugin,
  DurableInstrumentationPluginFactory,
  InvocationInfo,
} from "../../types/plugin";
import {
  DurableExecutionInvocationOutput,
  InvocationStatus,
} from "../../types/core";
import { createInvocationPluginRunner } from "./plugin-factory";

const succeededOutput: DurableExecutionInvocationOutput = {
  Status: InvocationStatus.SUCCEEDED,
  Result: "test-result",
};

const invocationInfo: InvocationInfo = {
  requestId: "req-1",
  executionArn: "arn:aws:lambda:us-east-1:123:function:fn:1/exec/abc",
  isFirstInvocation: true,
  executionInput: { test: true },
  operations: {},
  updatedOperations: {},
};

describe("createInvocationPluginRunner", () => {
  it("returns an empty runner when there are no factories", () => {
    expect(createInvocationPluginRunner([], invocationInfo)).toEqual({});
  });

  it("calls each factory exactly once per runner", () => {
    const factory = jest.fn(() => ({}));

    createInvocationPluginRunner([factory], invocationInfo);

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("hands the factory the invocation info the runner then dispatches", async () => {
    const seen: InvocationInfo[] = [];
    const factory: DurableInstrumentationPluginFactory = (info) => {
      seen.push(info);
      return {
        onInvocationStart: async (startInfo) => {
          seen.push(startInfo);
        },
      };
    };

    const runner = createInvocationPluginRunner([factory], invocationInfo);
    await runner.onInvocationStart?.(invocationInfo);

    // Same object, not an equal copy: a plugin may take its identity at
    // construction and compare it against what the first hook reports.
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(invocationInfo);
    expect(seen[1]).toBe(invocationInfo);
  });

  it("creates one instance per runner and dispatches to that instance", async () => {
    const created: DurableInstrumentationPlugin[] = [];
    const factory: DurableInstrumentationPluginFactory = () => {
      const plugin = { onInvocationStart: jest.fn() };
      created.push(plugin);
      return plugin;
    };

    await createInvocationPluginRunner(
      [factory],
      invocationInfo,
    ).onInvocationStart?.(invocationInfo);
    await createInvocationPluginRunner(
      [factory],
      invocationInfo,
    ).onInvocationStart?.(invocationInfo);

    expect(created).toHaveLength(2);
    expect(created[0]).not.toBe(created[1]);
    expect(created[0].onInvocationStart).toHaveBeenCalledTimes(1);
    expect(created[1].onInvocationStart).toHaveBeenCalledTimes(1);
  });

  it("preserves factory order in the dispatched instances", async () => {
    const calls: string[] = [];
    const factory =
      (name: string): DurableInstrumentationPluginFactory =>
      () => ({
        onInvocationStart: async () => {
          calls.push(name);
        },
      });

    await createInvocationPluginRunner(
      [factory("first"), factory("second")],
      invocationInfo,
    ).onInvocationStart?.(invocationInfo);

    expect(calls).toEqual(["first", "second"]);
  });

  it("keeps wrap hook nesting order across factory instances", async () => {
    const order: string[] = [];
    const wrapper = (
      name: string,
    ): DurableInstrumentationPlugin["wrapInvocation"] => {
      return async (_info, fn) => {
        order.push(`${name}-before`);
        const result = await fn();
        order.push(`${name}-after`);
        return result;
      };
    };

    const runner = createInvocationPluginRunner(
      [
        () => ({ wrapInvocation: wrapper("outer") }),
        () => ({ wrapInvocation: wrapper("inner") }),
      ],
      invocationInfo,
    );

    await expect(
      runner.wrapInvocation?.(invocationInfo, async () => {
        order.push("fn");
        return succeededOutput;
      }),
    ).resolves.toEqual(succeededOutput);
    expect(order).toEqual([
      "outer-before",
      "inner-before",
      "fn",
      "inner-after",
      "outer-after",
    ]);
  });

  it("contains a throwing factory and keeps the remaining plugins", async () => {
    const plugin: jest.Mocked<DurableInstrumentationPlugin> = {
      onInvocationStart: jest.fn(),
    };
    const throwingFactory: DurableInstrumentationPluginFactory = () => {
      throw new Error("factory bug");
    };

    const runner = createInvocationPluginRunner(
      [throwingFactory, () => plugin],
      invocationInfo,
    );

    await expect(
      runner.onInvocationStart?.(invocationInfo),
    ).resolves.toBeUndefined();
    expect(plugin.onInvocationStart).toHaveBeenCalledWith(invocationInfo);
  });

  it("degrades to the no-plugin runner when the only factory throws", async () => {
    const runner = createInvocationPluginRunner(
      [
        (): DurableInstrumentationPlugin => {
          throw new Error("factory bug");
        },
      ],
      invocationInfo,
    );

    // Same shape as an empty plugin list, so the SDK's call site
    // (`wrapInvocation?.(...) ?? executeInvocation()`) still runs the invocation.
    expect(runner).toEqual({});
    const executeInvocation =
      async (): Promise<DurableExecutionInvocationOutput> => succeededOutput;
    await expect(
      runner.wrapInvocation?.(invocationInfo, executeInvocation) ??
        executeInvocation(),
    ).resolves.toEqual(succeededOutput);
  });

  it("recovers on the next invocation after a factory throws once", async () => {
    const plugin: jest.Mocked<DurableInstrumentationPlugin> = {
      onInvocationStart: jest.fn(),
    };
    let attempt = 0;
    const factory: DurableInstrumentationPluginFactory = () => {
      attempt += 1;
      if (attempt === 1) throw new Error("cold start hiccup");
      return plugin;
    };

    await createInvocationPluginRunner(
      [factory],
      invocationInfo,
    ).onInvocationStart?.(invocationInfo);
    expect(plugin.onInvocationStart).not.toHaveBeenCalled();

    await createInvocationPluginRunner(
      [factory],
      invocationInfo,
    ).onInvocationStart?.(invocationInfo);
    expect(plugin.onInvocationStart).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null])(
    "skips a factory that returns %p",
    async (value) => {
      const plugin: jest.Mocked<DurableInstrumentationPlugin> = {
        onInvocationStart: jest.fn(),
      };
      const factory = (() =>
        value) as unknown as DurableInstrumentationPluginFactory;

      const runner = createInvocationPluginRunner(
        [factory, () => plugin],
        invocationInfo,
      );

      await expect(
        runner.onInvocationStart?.(invocationInfo),
      ).resolves.toBeUndefined();
      expect(plugin.onInvocationStart).toHaveBeenCalledTimes(1);
    },
  );

  it("merges enrichLogContext across factory plugins", () => {
    const runner = createInvocationPluginRunner(
      [
        () => ({ enrichLogContext: () => ({ traceId: "abc" }) }),
        () => ({ enrichLogContext: () => ({ spanId: "xyz" }) }),
      ],
      invocationInfo,
    );

    expect(runner.enrichLogContext?.()).toEqual({
      traceId: "abc",
      spanId: "xyz",
    });
  });
});
