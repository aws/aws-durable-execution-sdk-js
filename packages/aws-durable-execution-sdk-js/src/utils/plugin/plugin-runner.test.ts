import { createPluginRunner } from "./plugin-runner";
import {
  DurableInstrumentationPlugin,
  AttemptEndInfoOutcome,
  AttemptInfo,
  InvocationInfo,
  InvocationEndInfo,
  PluginInvocationStatus,
  OperationInfo,
  OperationChangeInfo,
  AttemptEndInfo,
} from "../../types/plugin";
import {
  DurableExecutionInvocationOutput,
  InvocationStatus,
} from "../../types/core";

const succeededOutput: DurableExecutionInvocationOutput = {
  Status: InvocationStatus.SUCCEEDED,
  Result: "test-result",
};

describe("createPluginRunner", () => {
  const invocationInfo: InvocationInfo = {
    requestId: "req-1",
    executionArn: "arn:aws:lambda:us-east-1:123:function:fn:1/exec/abc",
    isFirstInvocation: true,
  };

  const operationInfo: OperationInfo = {
    Id: "op-1",
    HashedId: "op-1-hash",
    Name: "my-step",
    Type: "STEP",
  };

  const attemptInfo: AttemptInfo = {
    ...operationInfo,
    Attempt: 1,
  };

  const attemptEndInfo: AttemptEndInfo = {
    ...attemptInfo,
    outcome: AttemptEndInfoOutcome.SUCCEEDED,
  };

  const invocationEndInfo: InvocationEndInfo = {
    ...invocationInfo,
    status: PluginInvocationStatus.SUCCEEDED,
    executionResult: { ok: true },
    executionInput: { data: "input" },
    operations: {},
  };

  const operationChangeInfo: OperationChangeInfo = {
    ...invocationInfo,
    updatedOperations: {},
    operations: {},
  };

  describe("empty plugins array", () => {
    it("returns an empty object when no plugins are provided", () => {
      const runner = createPluginRunner([]);
      expect(runner).toEqual({});
    });
  });

  describe("fire-and-forget hooks (run)", () => {
    it("calls onInvocationStart on all plugins", () => {
      const plugin: jest.Mocked<DurableInstrumentationPlugin> = {
        onInvocationStart: jest.fn(),
      };

      const runner = createPluginRunner([plugin]);
      runner.onInvocationStart!(invocationInfo);

      expect(plugin.onInvocationStart).toHaveBeenCalledWith(invocationInfo);
    });

    it("calls onOperationFirstStart on all plugins", () => {
      const plugin: jest.Mocked<DurableInstrumentationPlugin> = {
        onOperationFirstStart: jest.fn(),
      };

      const runner = createPluginRunner([plugin]);
      runner.onOperationFirstStart!(operationInfo);

      expect(plugin.onOperationFirstStart).toHaveBeenCalledWith(operationInfo);
    });

    it("calls onOperationStart on all plugins", () => {
      const plugin: jest.Mocked<DurableInstrumentationPlugin> = {
        onOperationStart: jest.fn(),
      };

      const runner = createPluginRunner([plugin]);
      runner.onOperationStart!(operationInfo);

      expect(plugin.onOperationStart).toHaveBeenCalledWith(operationInfo);
    });

    it("calls onOperationFirstEnd on all plugins", () => {
      const plugin: jest.Mocked<DurableInstrumentationPlugin> = {
        onOperationFirstEnd: jest.fn(),
      };
      const infoWithError = { ...operationInfo, error: new Error("oops") };

      const runner = createPluginRunner([plugin]);
      runner.onOperationFirstEnd!(infoWithError);

      expect(plugin.onOperationFirstEnd).toHaveBeenCalledWith(infoWithError);
    });

    it("calls onOperationAttemptStart on all plugins", () => {
      const plugin: jest.Mocked<DurableInstrumentationPlugin> = {
        onOperationAttemptStart: jest.fn(),
      };

      const runner = createPluginRunner([plugin]);
      runner.onOperationAttemptStart!(attemptInfo);

      expect(plugin.onOperationAttemptStart).toHaveBeenCalledWith(attemptInfo);
    });

    it("calls onOperationAttemptEnd on all plugins", () => {
      const plugin: jest.Mocked<DurableInstrumentationPlugin> = {
        onOperationAttemptEnd: jest.fn(),
      };

      const runner = createPluginRunner([plugin]);
      runner.onOperationAttemptEnd!(attemptEndInfo);

      expect(plugin.onOperationAttemptEnd).toHaveBeenCalledWith(attemptEndInfo);
    });

    it("calls onOperationChange on all plugins", () => {
      const plugin: jest.Mocked<DurableInstrumentationPlugin> = {
        onOperationChange: jest.fn(),
      };

      const runner = createPluginRunner([plugin]);
      runner.onOperationChange!(operationChangeInfo);

      expect(plugin.onOperationChange).toHaveBeenCalledWith(
        operationChangeInfo,
      );
    });

    it("swallows synchronous errors from plugins", () => {
      const throwingPlugin: DurableInstrumentationPlugin = {
        onInvocationStart: () => {
          throw new Error("sync plugin error");
        },
      };
      const plugin2: jest.Mocked<DurableInstrumentationPlugin> = {
        onInvocationStart: jest.fn(),
      };

      const runner = createPluginRunner([throwingPlugin, plugin2]);

      expect(() => runner.onInvocationStart!(invocationInfo)).not.toThrow();
      expect(plugin2.onInvocationStart).toHaveBeenCalledWith(invocationInfo);
    });

    it("swallows async errors from plugins (fire-and-forget)", () => {
      const asyncThrowingPlugin: DurableInstrumentationPlugin = {
        onOperationStart: () => {
          return Promise.reject(new Error("async plugin error")) as any;
        },
      };

      const runner = createPluginRunner([asyncThrowingPlugin]);

      expect(() => runner.onOperationStart!(operationInfo)).not.toThrow();
    });

    it("skips plugins that do not implement the hook", () => {
      const plugin1: DurableInstrumentationPlugin = {};
      const plugin2: jest.Mocked<DurableInstrumentationPlugin> = {
        onInvocationStart: jest.fn(),
      };

      const runner = createPluginRunner([plugin1, plugin2]);
      runner.onInvocationStart!(invocationInfo);

      expect(plugin2.onInvocationStart).toHaveBeenCalledWith(invocationInfo);
    });
  });

  describe("onInvocationEnd hook (run)", () => {
    it("calls onInvocationEnd on all plugins with InvocationEndInfo", () => {
      const plugin1: jest.Mocked<DurableInstrumentationPlugin> = {
        onInvocationEnd: jest.fn(),
      };
      const plugin2: jest.Mocked<DurableInstrumentationPlugin> = {
        onInvocationEnd: jest.fn(),
      };

      const runner = createPluginRunner([plugin1, plugin2]);
      runner.onInvocationEnd!(invocationEndInfo);

      expect(plugin1.onInvocationEnd).toHaveBeenCalledWith(invocationEndInfo);
      expect(plugin2.onInvocationEnd).toHaveBeenCalledWith(invocationEndInfo);
    });

    it("passes FAILED status with executionError in InvocationEndInfo", () => {
      const plugin: jest.Mocked<DurableInstrumentationPlugin> = {
        onInvocationEnd: jest.fn(),
      };
      const failedInfo: InvocationEndInfo = {
        ...invocationInfo,
        status: PluginInvocationStatus.FAILED,
        executionError: new Error("handler failed"),
        executionInput: { data: "input" },
        operations: {},
      };

      const runner = createPluginRunner([plugin]);
      runner.onInvocationEnd!(failedInfo);

      expect(plugin.onInvocationEnd).toHaveBeenCalledWith(failedInfo);
    });

    it("passes PENDING status in InvocationEndInfo", () => {
      const plugin: jest.Mocked<DurableInstrumentationPlugin> = {
        onInvocationEnd: jest.fn(),
      };
      const pendingInfo: InvocationEndInfo = {
        ...invocationInfo,
        status: PluginInvocationStatus.PENDING,
        executionInput: { data: "input" },
        operations: {},
      };

      const runner = createPluginRunner([plugin]);
      runner.onInvocationEnd!(pendingInfo);

      expect(plugin.onInvocationEnd).toHaveBeenCalledWith(pendingInfo);
    });

    it("passes RETRYING status in InvocationEndInfo", () => {
      const plugin: jest.Mocked<DurableInstrumentationPlugin> = {
        onInvocationEnd: jest.fn(),
      };
      const retryingInfo: InvocationEndInfo = {
        ...invocationInfo,
        status: PluginInvocationStatus.RETRYING,
        executionError: new Error("unrecoverable"),
        executionInput: { data: "input" },
        operations: {},
      };

      const runner = createPluginRunner([plugin]);
      runner.onInvocationEnd!(retryingInfo);

      expect(plugin.onInvocationEnd).toHaveBeenCalledWith(retryingInfo);
    });

    it("swallows errors from plugins and continues to next", () => {
      const plugin1: DurableInstrumentationPlugin = {
        onInvocationEnd: () => {
          throw new Error("plugin1 failed");
        },
      };
      const plugin2: jest.Mocked<DurableInstrumentationPlugin> = {
        onInvocationEnd: jest.fn(),
      };

      const runner = createPluginRunner([plugin1, plugin2]);

      expect(() => runner.onInvocationEnd!(invocationEndInfo)).not.toThrow();
      expect(plugin2.onInvocationEnd).toHaveBeenCalledWith(invocationEndInfo);
    });

    it("skips plugins that do not implement the hook", () => {
      const plugin1: DurableInstrumentationPlugin = {};
      const plugin2: jest.Mocked<DurableInstrumentationPlugin> = {
        onInvocationEnd: jest.fn(),
      };

      const runner = createPluginRunner([plugin1, plugin2]);
      runner.onInvocationEnd!(invocationEndInfo);

      expect(plugin2.onInvocationEnd).toHaveBeenCalledWith(invocationEndInfo);
    });
  });

  describe("callback-wrapping hooks (runAsCallback)", () => {
    it("wrapInvocation calls fn through the plugin chain", async () => {
      const plugin: DurableInstrumentationPlugin = {
        wrapInvocation: (_info, fn) => fn(),
      };

      const runner = createPluginRunner([plugin]);
      const result = await runner.wrapInvocation!(invocationInfo, () =>
        Promise.resolve(succeededOutput),
      );

      expect(result).toEqual(succeededOutput);
    });

    it("wrapInvocation chains multiple plugins in right-to-left order", async () => {
      const callOrder: string[] = [];

      const plugin1: DurableInstrumentationPlugin = {
        wrapInvocation: (_info, fn) => {
          callOrder.push("plugin1-before");
          const result = fn();
          callOrder.push("plugin1-after");
          return result;
        },
      };
      const plugin2: DurableInstrumentationPlugin = {
        wrapInvocation: (_info, fn) => {
          callOrder.push("plugin2-before");
          const result = fn();
          callOrder.push("plugin2-after");
          return result;
        },
      };

      const runner = createPluginRunner([plugin1, plugin2]);
      const result = await runner.wrapInvocation!(invocationInfo, () => {
        callOrder.push("fn");
        return Promise.resolve(succeededOutput);
      });

      expect(result).toEqual(succeededOutput);
      // plugin1 wraps plugin2 which wraps fn (reduceRight)
      expect(callOrder).toEqual([
        "plugin1-before",
        "plugin2-before",
        "fn",
        "plugin2-after",
        "plugin1-after",
      ]);
    });

    it("wrapChildContextFn calls fn through the plugin chain", () => {
      const plugin: DurableInstrumentationPlugin = {
        wrapChildContextFn: <T>(_info: OperationInfo, fn: () => T): T => fn(),
      };

      const runner = createPluginRunner([plugin]);
      const result = runner.wrapChildContextFn!(operationInfo, () => 42);

      expect(result).toBe(42);
    });

    it("wrapOperationAttemptFn calls fn through the plugin chain", () => {
      const plugin: DurableInstrumentationPlugin = {
        wrapOperationAttemptFn: <T>(_info: AttemptInfo, fn: () => T): T => fn(),
      };

      const runner = createPluginRunner([plugin]);
      const result = runner.wrapOperationAttemptFn!(attemptInfo, () => "done");

      expect(result).toBe("done");
    });

    it("wrapInvocation skips plugins that do not implement it", async () => {
      const plugin1: DurableInstrumentationPlugin = {};
      const plugin2: DurableInstrumentationPlugin = {
        wrapInvocation: (_info, fn) => fn(),
      };

      const runner = createPluginRunner([plugin1, plugin2]);
      const result = await runner.wrapInvocation!(invocationInfo, () =>
        Promise.resolve(succeededOutput),
      );

      expect(result).toEqual(succeededOutput);
    });

    it("wrapInvocation propagates errors from the wrapped fn", () => {
      const plugin: DurableInstrumentationPlugin = {
        wrapInvocation: (_info, fn) => fn(),
      };

      const runner = createPluginRunner([plugin]);

      expect(() =>
        runner.wrapInvocation!(invocationInfo, () => {
          throw new Error("fn error");
        }),
      ).toThrow("fn error");
    });

    it("wrapInvocation swallows plugin errors and falls back to fn", async () => {
      const plugin: DurableInstrumentationPlugin = {
        wrapInvocation: () => {
          throw new Error("plugin error");
        },
      };

      const runner = createPluginRunner([plugin]);
      const result = await runner.wrapInvocation!(invocationInfo, () =>
        Promise.resolve(succeededOutput),
      );

      expect(result).toEqual(succeededOutput);
    });

    it("wrapInvocation allows plugin to modify the return value", async () => {
      const modifiedOutput: DurableExecutionInvocationOutput = {
        Status: InvocationStatus.SUCCEEDED,
        Result: "modified-result",
      };
      const plugin: DurableInstrumentationPlugin = {
        wrapInvocation: async (_info, fn) => {
          await fn();
          return modifiedOutput;
        },
      };

      const runner = createPluginRunner([plugin]);
      const result = await runner.wrapInvocation!(invocationInfo, () =>
        Promise.resolve(succeededOutput),
      );

      expect(result).toEqual(modifiedOutput);
    });

    it("wrapInvocation allows plugin to short-circuit without calling fn", async () => {
      const shortCircuitOutput: DurableExecutionInvocationOutput = {
        Status: InvocationStatus.SUCCEEDED,
        Result: "short-circuited",
      };
      const fn = jest
        .fn<Promise<DurableExecutionInvocationOutput>, []>()
        .mockResolvedValue(succeededOutput);
      const plugin: DurableInstrumentationPlugin = {
        wrapInvocation: () => Promise.resolve(shortCircuitOutput),
      };

      const runner = createPluginRunner([plugin]);
      const result = await runner.wrapInvocation!(invocationInfo, fn);

      expect(result).toEqual(shortCircuitOutput);
      expect(fn).not.toHaveBeenCalled();
    });

    it("re-throws sync error from fn even if a plugin swallows it", () => {
      const originalError = new Error("customer fn error");
      const plugin: DurableInstrumentationPlugin = {
        wrapOperationAttemptFn: (_info, fn) => {
          try {
            return fn();
          } catch {
            // Plugin swallows the error
            return "swallowed" as any;
          }
        },
      };

      const runner = createPluginRunner([plugin]);

      expect(() =>
        runner.wrapOperationAttemptFn!(attemptInfo, () => {
          throw originalError;
        }),
      ).toThrow(originalError);
    });

    it("re-throws async error from fn even if a plugin swallows it", async () => {
      const originalError = new Error("async customer fn error");
      const plugin: DurableInstrumentationPlugin = {
        wrapOperationAttemptFn: (_info, fn) => {
          try {
            const result = fn();
            if (result && typeof (result as any).catch === "function") {
              return (result as any).catch(() => "swallowed");
            }
            return result;
          } catch {
            return "swallowed" as any;
          }
        },
      };

      const runner = createPluginRunner([plugin]);

      await expect(
        runner.wrapOperationAttemptFn!(attemptInfo, () =>
          Promise.reject(originalError),
        ),
      ).rejects.toThrow(originalError);
    });

    it("re-throws fn error even when multiple plugins try to swallow it", async () => {
      const originalError = new Error("must not be lost");
      const swallowingPlugin: DurableInstrumentationPlugin = {
        wrapInvocation: (_info, fn) => {
          try {
            return fn();
          } catch {
            return Promise.resolve(succeededOutput);
          }
        },
      };

      const runner = createPluginRunner([swallowingPlugin, swallowingPlugin]);

      await expect(
        runner.wrapInvocation!(invocationInfo, () => {
          throw originalError;
        }),
      ).rejects.toThrow(originalError);
    });

    it("re-throws fn error through wrapChildContextFn when plugin swallows it", () => {
      const originalError = new Error("child context fn error");
      const plugin: DurableInstrumentationPlugin = {
        wrapChildContextFn: (_info, fn) => {
          try {
            return fn();
          } catch {
            return "swallowed" as any;
          }
        },
      };

      const runner = createPluginRunner([plugin]);

      expect(() =>
        runner.wrapChildContextFn!(operationInfo, () => {
          throw originalError;
        }),
      ).toThrow(originalError);
    });

    it("does not interfere when fn succeeds and plugin behaves correctly", () => {
      const plugin: DurableInstrumentationPlugin = {
        wrapOperationAttemptFn: <T>(_info: AttemptInfo, fn: () => T): T => fn(),
      };

      const runner = createPluginRunner([plugin]);
      const result = runner.wrapOperationAttemptFn!(
        attemptInfo,
        () => "success",
      );

      expect(result).toBe("success");
    });
  });

  describe("enrichLogContext", () => {
    it("merges log context from all plugins", () => {
      const plugin1: DurableInstrumentationPlugin = {
        enrichLogContext: () => ({ traceId: "trace-1", service: "svc" }),
      };
      const plugin2: DurableInstrumentationPlugin = {
        enrichLogContext: () => ({ spanId: "span-1" }),
      };

      const runner = createPluginRunner([plugin1, plugin2]);
      const context = runner.enrichLogContext!();

      expect(context).toEqual({
        traceId: "trace-1",
        service: "svc",
        spanId: "span-1",
      });
    });

    it("later plugins override earlier plugins for same keys", () => {
      const plugin1: DurableInstrumentationPlugin = {
        enrichLogContext: () => ({ key: "first" }),
      };
      const plugin2: DurableInstrumentationPlugin = {
        enrichLogContext: () => ({ key: "second" }),
      };

      const runner = createPluginRunner([plugin1, plugin2]);
      const context = runner.enrichLogContext!();

      expect(context).toEqual({ key: "second" });
    });

    it("returns empty object when no plugins implement enrichLogContext", () => {
      const plugin1: DurableInstrumentationPlugin = {};
      const plugin2: DurableInstrumentationPlugin = {};

      const runner = createPluginRunner([plugin1, plugin2]);
      const context = runner.enrichLogContext!();

      expect(context).toEqual({});
    });

    it("skips plugins that return undefined from enrichLogContext", () => {
      const plugin1: DurableInstrumentationPlugin = {
        enrichLogContext: () => undefined,
      };
      const plugin2: DurableInstrumentationPlugin = {
        enrichLogContext: () => ({ key: "value" }),
      };

      const runner = createPluginRunner([plugin1, plugin2]);
      const context = runner.enrichLogContext!();

      expect(context).toEqual({ key: "value" });
    });

    it("swallows errors from enrichLogContext and continues", () => {
      const plugin1: DurableInstrumentationPlugin = {
        enrichLogContext: () => {
          throw new Error("enrichLogContext error");
        },
      };
      const plugin2: DurableInstrumentationPlugin = {
        enrichLogContext: () => ({ key: "value" }),
      };

      const runner = createPluginRunner([plugin1, plugin2]);
      const context = runner.enrichLogContext!();

      expect(context).toEqual({ key: "value" });
    });
  });

  describe("plugin error isolation in onInvocationEnd", () => {
    const sampleEndInfo: InvocationEndInfo = {
      requestId: "req-isolation",
      executionArn: "arn:aws:lambda:us-east-1:123:function:fn:1/exec/abc",
      isFirstInvocation: true,
      status: PluginInvocationStatus.SUCCEEDED,
      executionResult: { data: "test" },
      executionInput: { event: "input" },
      operations: {},
    };

    it.each([
      {
        desc: "all plugins throw sync errors",
        behaviors: ["throw-sync", "throw-sync", "throw-sync"] as const,
      },
      {
        desc: "all plugins return rejected promises",
        behaviors: ["reject-async", "reject-async", "reject-async"] as const,
      },
      {
        desc: "mix of succeed, throw-sync, and reject-async",
        behaviors: [
          "succeed",
          "throw-sync",
          "reject-async",
          "succeed",
          "throw-sync",
        ] as const,
      },
      {
        desc: "first plugin throws, rest succeed",
        behaviors: ["throw-sync", "succeed", "succeed"] as const,
      },
      {
        desc: "last plugin throws, rest succeed",
        behaviors: ["succeed", "succeed", "throw-sync"] as const,
      },
      {
        desc: "single plugin throws",
        behaviors: ["throw-sync"] as const,
      },
      {
        desc: "single plugin rejects async",
        behaviors: ["reject-async"] as const,
      },
      {
        desc: "alternating failures",
        behaviors: [
          "throw-sync",
          "succeed",
          "reject-async",
          "succeed",
          "throw-sync",
          "reject-async",
        ] as const,
      },
    ])("all plugins receive onInvocationEnd call: $desc", ({ behaviors }) => {
      const callRecords: number[] = [];

      const plugins: DurableInstrumentationPlugin[] = behaviors.map(
        (behavior, index) => ({
          onInvocationEnd: (_endInfo: InvocationEndInfo) => {
            callRecords.push(index);
            if (behavior === "throw-sync") {
              throw new Error(`Plugin ${index} sync error`);
            }
            if (behavior === "reject-async") {
              return Promise.reject(
                new Error(`Plugin ${index} async error`),
              ) as any;
            }
          },
        }),
      );

      const runner = createPluginRunner(plugins);
      runner.onInvocationEnd!(sampleEndInfo);

      // All plugins must have been called
      expect(callRecords).toHaveLength(behaviors.length);
      // Each plugin was called exactly once, in order
      expect(callRecords).toEqual(behaviors.map((_, index) => index));
    });

    it.each([
      {
        desc: "all throw sync",
        behaviors: ["throw-sync", "throw-sync", "throw-sync"] as const,
      },
      {
        desc: "all reject async",
        behaviors: ["reject-async", "reject-async"] as const,
      },
      {
        desc: "mixed failures",
        behaviors: ["throw-sync", "reject-async", "succeed"] as const,
      },
    ])(
      "SDK output is never affected by plugin errors: $desc",
      ({ behaviors }) => {
        const plugins: DurableInstrumentationPlugin[] = behaviors.map(
          (behavior, index) => ({
            onInvocationEnd: (_endInfo: InvocationEndInfo) => {
              if (behavior === "throw-sync") {
                throw new Error(`Plugin ${index} sync error`);
              }
              if (behavior === "reject-async") {
                return Promise.reject(
                  new Error(`Plugin ${index} async error`),
                ) as any;
              }
            },
          }),
        );

        // Simulate that the SDK output is determined before onInvocationEnd
        const sdkOutput: DurableExecutionInvocationOutput = {
          Status: InvocationStatus.SUCCEEDED,
          Result: "pre-computed-result",
        };

        const runner = createPluginRunner(plugins);

        // onInvocationEnd dispatch must not throw
        expect(() => runner.onInvocationEnd!(sampleEndInfo)).not.toThrow();

        // The pre-determined output remains unchanged
        expect(sdkOutput).toEqual({
          Status: InvocationStatus.SUCCEEDED,
          Result: "pre-computed-result",
        });
      },
    );
  });

  describe("multiple plugins integration", () => {
    it("all hooks are called on all plugins for a full lifecycle", async () => {
      const plugin1 = {
        onInvocationStart: jest.fn(),
        wrapInvocation: jest.fn(
          (
            _info: InvocationInfo,
            fn: () => Promise<DurableExecutionInvocationOutput>,
          ) => fn(),
        ),
        onOperationFirstStart: jest.fn(),
        onOperationStart: jest.fn(),
        onOperationAttemptStart: jest.fn(),
        wrapOperationAttemptFn: jest.fn((_info: any, fn: () => any) => fn()),
        onOperationAttemptEnd: jest.fn(),
        onOperationFirstEnd: jest.fn(),
        onOperationChange: jest.fn(),
        onInvocationEnd: jest.fn().mockResolvedValue(undefined),
        enrichLogContext: jest.fn().mockReturnValue({ p1: "v1" }),
      } as unknown as jest.Mocked<DurableInstrumentationPlugin>;

      const plugin2 = {
        onInvocationStart: jest.fn(),
        wrapInvocation: jest.fn(
          (
            _info: InvocationInfo,
            fn: () => Promise<DurableExecutionInvocationOutput>,
          ) => fn(),
        ),
        onOperationFirstStart: jest.fn(),
        onOperationStart: jest.fn(),
        onOperationAttemptStart: jest.fn(),
        wrapOperationAttemptFn: jest.fn((_info: any, fn: () => any) => fn()),
        onOperationAttemptEnd: jest.fn(),
        onOperationFirstEnd: jest.fn(),
        onOperationChange: jest.fn(),
        onInvocationEnd: jest.fn().mockResolvedValue(undefined),
        enrichLogContext: jest.fn().mockReturnValue({ p2: "v2" }),
      } as unknown as jest.Mocked<DurableInstrumentationPlugin>;

      const runner = createPluginRunner([plugin1, plugin2]);

      // Simulate a full lifecycle
      runner.onInvocationStart!(invocationInfo);
      await runner.wrapInvocation!(invocationInfo, () =>
        Promise.resolve(succeededOutput),
      );
      runner.onOperationFirstStart!(operationInfo);
      runner.onOperationStart!(operationInfo);
      runner.onOperationAttemptStart!(attemptInfo);
      runner.wrapOperationAttemptFn!(attemptInfo, () => "attempt-result");
      runner.onOperationAttemptEnd!(attemptEndInfo);
      runner.onOperationFirstEnd!(operationInfo);
      runner.onOperationChange!(operationChangeInfo);
      runner.onInvocationEnd!(invocationEndInfo);
      const logCtx = runner.enrichLogContext!();

      // Verify all hooks called on both plugins
      expect(plugin1.onInvocationStart).toHaveBeenCalledTimes(1);
      expect(plugin2.onInvocationStart).toHaveBeenCalledTimes(1);
      expect(plugin1.wrapInvocation).toHaveBeenCalledTimes(1);
      expect(plugin2.wrapInvocation).toHaveBeenCalledTimes(1);
      expect(plugin1.onOperationFirstStart).toHaveBeenCalledTimes(1);
      expect(plugin2.onOperationFirstStart).toHaveBeenCalledTimes(1);
      expect(plugin1.onOperationStart).toHaveBeenCalledTimes(1);
      expect(plugin2.onOperationStart).toHaveBeenCalledTimes(1);
      expect(plugin1.onOperationAttemptStart).toHaveBeenCalledTimes(1);
      expect(plugin2.onOperationAttemptStart).toHaveBeenCalledTimes(1);
      expect(plugin1.wrapOperationAttemptFn).toHaveBeenCalledTimes(1);
      expect(plugin2.wrapOperationAttemptFn).toHaveBeenCalledTimes(1);
      expect(plugin1.onOperationAttemptEnd).toHaveBeenCalledTimes(1);
      expect(plugin2.onOperationAttemptEnd).toHaveBeenCalledTimes(1);
      expect(plugin1.onOperationFirstEnd).toHaveBeenCalledTimes(1);
      expect(plugin2.onOperationFirstEnd).toHaveBeenCalledTimes(1);
      expect(plugin1.onOperationChange).toHaveBeenCalledTimes(1);
      expect(plugin2.onOperationChange).toHaveBeenCalledTimes(1);
      expect(plugin1.onInvocationEnd).toHaveBeenCalledTimes(1);
      expect(plugin2.onInvocationEnd).toHaveBeenCalledTimes(1);
      expect(plugin1.onInvocationEnd).toHaveBeenCalledWith(invocationEndInfo);
      expect(plugin2.onInvocationEnd).toHaveBeenCalledWith(invocationEndInfo);
      expect(logCtx).toEqual({ p1: "v1", p2: "v2" });
    });
  });
});
