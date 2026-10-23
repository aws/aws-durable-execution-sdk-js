/**
 * CONTRACT TEST, in part. The cases about waiting, ordering and the drain guard invariants
 * listed in packages/aws-durable-execution-sdk-js/AGENTS.md and
 * docs/adr/0001-operation-tracking-and-plugin-hooks.md. If a change makes one of them fail, the
 * change breaks an invariant. Do not edit, skip or delete the case to make the change pass.
 * Change the ADR first.
 */
import {
  createPluginRunner,
  PLUGIN_DRAIN_RESERVE_MS,
  PLUGIN_END_RESERVE_MS,
} from "./plugin-runner";
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
    executionInput: { test: true },
    operations: {},
    updatedOperations: {},
    executionStartTimestamp: new Date("2024-01-01T00:00:00Z"),
  };

  const operationInfo: OperationInfo = {
    id: "op-1",
    name: "my-step",
    type: "STEP",
    isReplay: false,
  };

  const attemptInfo: AttemptInfo = {
    ...operationInfo,
    attempt: 1,
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
    executionArn: "arn:aws:lambda:us-east-1:123:function:fn:1/exec/abc",
    updatedOperations: {},
    operations: {},
  };

  describe("empty plugins array", () => {
    it("returns an empty object when no plugins are provided", () => {
      const runner = createPluginRunner([]);
      expect(runner).toEqual({});
    });
  });

  describe("lifecycle hooks (awaited via run)", () => {
    it("calls onInvocationStart on all plugins", () => {
      const plugin: jest.Mocked<DurableInstrumentationPlugin> = {
        onInvocationStart: jest.fn(),
      };

      const runner = createPluginRunner([plugin]);
      runner.onInvocationStart!(invocationInfo);

      expect(plugin.onInvocationStart).toHaveBeenCalledWith(invocationInfo);
    });

    it("calls onOperationStart on all plugins", () => {
      const plugin: jest.Mocked<DurableInstrumentationPlugin> = {
        onOperationStart: jest.fn(),
      };

      const runner = createPluginRunner([plugin]);
      runner.onOperationStart!(operationInfo);

      expect(plugin.onOperationStart).toHaveBeenCalledWith(operationInfo);
    });

    it("calls onOperationStart on all plugins", () => {
      const plugin: jest.Mocked<DurableInstrumentationPlugin> = {
        onOperationStart: jest.fn(),
      };

      const runner = createPluginRunner([plugin]);
      runner.onOperationStart!(operationInfo);

      expect(plugin.onOperationStart).toHaveBeenCalledWith(operationInfo);
    });

    it("calls onOperationEnd on all plugins", () => {
      const plugin: jest.Mocked<DurableInstrumentationPlugin> = {
        onOperationEnd: jest.fn(),
      };
      const infoWithError = { ...operationInfo, error: new Error("oops") };

      const runner = createPluginRunner([plugin]);
      runner.onOperationEnd!(infoWithError);

      expect(plugin.onOperationEnd).toHaveBeenCalledWith(infoWithError);
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

    it("swallows async errors from plugins", () => {
      const asyncThrowingPlugin: DurableInstrumentationPlugin = {
        onOperationStart: () => {
          return Promise.reject(new Error("async plugin error")) as any;
        },
      };

      const runner = createPluginRunner([asyncThrowingPlugin]);

      expect(() => runner.onOperationStart!(operationInfo)).not.toThrow();
    });

    it("does not wait for async work from an operation hook", async () => {
      let hookCompleted = false;
      const plugin: DurableInstrumentationPlugin = {
        onOperationStart: () => new Promise<void>(() => {}),
        onOperationEnd: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          hookCompleted = true;
        },
      };

      const runner = createPluginRunner([plugin]);

      // Both resolve although one hook never settles and the other is slow.
      await runner.onOperationStart!(operationInfo);
      await runner.onOperationEnd!(operationInfo);
      expect(hookCompleted).toBe(false);
    });

    it("runs the synchronous part of every hook before returning, in call order", () => {
      const calls: string[] = [];
      const record = (name: string) => async (): Promise<void> => {
        calls.push(name);
        await new Promise(() => {});
      };
      const plugin: DurableInstrumentationPlugin = {
        onOperationStart: record("start"),
        onOperationAttemptStart: record("attempt-start"),
        onOperationAttemptEnd: record("attempt-end"),
        onOperationEnd: record("end"),
        onOperationChange: record("change"),
      };

      const runner = createPluginRunner([plugin]);
      void runner.onOperationStart!(operationInfo);
      void runner.onOperationAttemptStart!(attemptInfo);
      void runner.onOperationAttemptEnd!(attemptEndInfo);
      void runner.onOperationEnd!(operationInfo);
      void runner.onOperationChange!(operationChangeInfo);

      expect(calls).toEqual([
        "start",
        "attempt-start",
        "attempt-end",
        "end",
        "change",
      ]);
    });

    it("still waits for onInvocationStart", async () => {
      let hookCompleted = false;
      const plugin: DurableInstrumentationPlugin = {
        onInvocationStart: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          hookCompleted = true;
        },
      };

      await createPluginRunner([plugin]).onInvocationStart!(invocationInfo);
      expect(hookCompleted).toBe(true);
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

    it("returns a promise that resolves only after async plugin work completes", async () => {
      let resolveHook: (() => void) | undefined;
      let hookCompleted = false;
      const plugin: DurableInstrumentationPlugin = {
        onInvocationEnd: () =>
          new Promise<void>((resolve) => {
            resolveHook = (): void => {
              hookCompleted = true;
              resolve();
            };
          }),
      };

      const runner = createPluginRunner([plugin]);
      const pending = runner.onInvocationEnd!(
        invocationEndInfo,
      ) as Promise<void>;

      // The hook has not resolved yet, so the runner promise must still be pending
      expect(hookCompleted).toBe(false);

      resolveHook!();
      await pending;

      expect(hookCompleted).toBe(true);
    });

    it("awaits all plugins before resolving", async () => {
      const order: string[] = [];
      const makePlugin = (
        name: string,
        delay: number,
      ): DurableInstrumentationPlugin => ({
        onInvocationEnd: () =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              order.push(name);
              resolve();
            }, delay),
          ),
      });

      const runner = createPluginRunner([
        makePlugin("slow", 20),
        makePlugin("fast", 5),
      ]);

      await runner.onInvocationEnd!(invocationEndInfo);

      // Both plugins ran and the runner waited for the slowest one
      expect(order).toEqual(["fast", "slow"]);
    });

    it("does not reject when a plugin returns a rejected promise", async () => {
      const rejectingPlugin: DurableInstrumentationPlugin = {
        onInvocationEnd: () => Promise.reject(new Error("async plugin error")),
      };
      const plugin2: jest.Mocked<DurableInstrumentationPlugin> = {
        onInvocationEnd: jest.fn(),
      };

      const runner = createPluginRunner([rejectingPlugin, plugin2]);

      await expect(
        runner.onInvocationEnd!(invocationEndInfo),
      ).resolves.toBeUndefined();
      expect(plugin2.onInvocationEnd).toHaveBeenCalledWith(invocationEndInfo);
    });

    it("drains pending operation-hook work before calling onInvocationEnd", async () => {
      const events: string[] = [];
      const plugin: DurableInstrumentationPlugin = {
        onOperationEnd: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          events.push("operation-end settled");
        },
        onInvocationEnd: async () => {
          events.push("invocation-end called");
        },
      };

      const runner = createPluginRunner([plugin]);
      await runner.onOperationEnd!(operationInfo);
      expect(events).toEqual([]);

      await runner.onInvocationEnd!(invocationEndInfo);
      expect(events).toEqual([
        "operation-end settled",
        "invocation-end called",
      ]);
    });

    it("drains hook work that settling hook work starts", async () => {
      const events: string[] = [];
      let runner: DurableInstrumentationPlugin;
      const plugin: DurableInstrumentationPlugin = {
        onOperationEnd: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          void runner.onOperationChange!(operationChangeInfo);
        },
        onOperationChange: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          events.push("change settled");
        },
      };

      runner = createPluginRunner([plugin]);
      await runner.onOperationEnd!(operationInfo);
      await runner.onInvocationEnd!(invocationEndInfo);
      expect(events).toEqual(["change settled"]);
    });

    it("bounds the drain and onInvocationEnd by two deadlines", async () => {
      let endCalledAt = 0;
      const plugin: DurableInstrumentationPlugin = {
        onOperationEnd: () => new Promise<void>(() => {}),
        onInvocationEnd: () => {
          endCalledAt = Date.now();
          return new Promise<void>(() => {});
        },
      };

      // The drain may run until 100 ms before its reserve. onInvocationEnd may
      // run until PLUGIN_END_RESERVE_MS before the deadline.
      const remainingMs = PLUGIN_DRAIN_RESERVE_MS + 100;
      const runner = createPluginRunner([plugin], {
        getRemainingTimeMs: () => remainingMs,
      });
      await runner.onOperationEnd!(operationInfo);

      const started = Date.now();
      await runner.onInvocationEnd!(invocationEndInfo);
      const elapsed = Date.now() - started;

      // The never-settling operation hook used the drain's 100 ms.
      expect(endCalledAt - started).toBeGreaterThanOrEqual(90);
      expect(endCalledAt - started).toBeLessThan(300);
      // The never-settling onInvocationEnd was waited for until its deadline.
      expect(elapsed).toBeGreaterThanOrEqual(
        remainingMs - PLUGIN_END_RESERVE_MS - 10,
      );
      expect(elapsed).toBeLessThan(remainingMs);
    });

    it("keeps time for onInvocationEnd's flush when operation-hook work never settles", async () => {
      // The drain must stop well before the end deadline. If the two reserves
      // were equal, the never-settling hook would use the time the flush needs.
      let flushed = false;
      const runner = createPluginRunner(
        [
          {
            onOperationEnd: () => new Promise<void>(() => {}),
            onInvocationEnd: async () => {
              await new Promise((resolve) => setTimeout(resolve, 100));
              flushed = true;
            },
          },
        ],
        { getRemainingTimeMs: () => 700 },
      );
      await runner.onOperationEnd!(operationInfo);

      await runner.onInvocationEnd!(invocationEndInfo);
      expect(flushed).toBe(true);
    });

    it("lets onInvocationEnd flush when less time is left than the drain reserve", async () => {
      let flushed = false;
      const runner = createPluginRunner(
        [
          {
            onInvocationEnd: async () => {
              await new Promise((resolve) => setTimeout(resolve, 50));
              flushed = true;
            },
          },
        ],
        { getRemainingTimeMs: () => 300 },
      );

      await runner.onInvocationEnd!(invocationEndInfo);
      expect(flushed).toBe(true);
    });

    it("skips waiting when less time is left than the end reserve", async () => {
      const onInvocationEnd = jest.fn(() => new Promise<void>(() => {}));
      const runner = createPluginRunner(
        [
          {
            onOperationEnd: () => new Promise<void>(() => {}),
            onInvocationEnd,
          },
        ],
        { getRemainingTimeMs: () => PLUGIN_END_RESERVE_MS - 1 },
      );
      await runner.onOperationEnd!(operationInfo);

      await runner.onInvocationEnd!(invocationEndInfo);
      expect(onInvocationEnd).toHaveBeenCalledTimes(1);
    });

    it.each([
      [
        "throws",
        (): number => {
          throw new Error("no deadline");
        },
      ],
      ["returns NaN", (): number => Number.NaN],
      ["returns a non-number", (): number => "soon" as unknown as number],
    ])(
      "waits for everything when reading the remaining time %s",
      async (_case, getRemainingTimeMs) => {
        const events: string[] = [];
        const runner = createPluginRunner(
          [
            {
              onOperationEnd: async () => {
                await new Promise((resolve) => setTimeout(resolve, 30));
                events.push("operation-end settled");
              },
              onInvocationEnd: async () => {
                await new Promise((resolve) => setTimeout(resolve, 30));
                events.push("invocation-end settled");
              },
            },
          ],
          { getRemainingTimeMs },
        );
        await runner.onOperationEnd!(operationInfo);

        await expect(
          runner.onInvocationEnd!(invocationEndInfo),
        ).resolves.toBeUndefined();
        expect(events).toEqual([
          "operation-end settled",
          "invocation-end settled",
        ]);
      },
    );

    it("caps each drain timer, so a far deadline does not overflow setTimeout", async () => {
      // Node runs a delay above 2^31 - 1 ms after 1 ms instead.
      const timerSpy = jest.spyOn(global, "setTimeout");
      const runner = createPluginRunner(
        [
          {
            onOperationEnd: () =>
              new Promise<void>((resolve) => setTimeout(resolve, 50)),
          },
        ],
        { getRemainingTimeMs: () => 30 * 24 * 60 * 60 * 1000 },
      );
      await runner.onOperationEnd!(operationInfo);

      await runner.onInvocationEnd!(invocationEndInfo);
      const delays = timerSpy.mock.calls.map((args) => Number(args[1] ?? 0));
      timerSpy.mockRestore();
      expect(Math.max(...delays)).toBeLessThanOrEqual(2 ** 31 - 1);
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

    it("contains a wrapper that rejects after fn succeeded", async () => {
      const plugin: DurableInstrumentationPlugin = {
        wrapInvocation: async (_info, fn) => {
          await fn();
          throw new Error("wrapper failed after fn");
        },
      };

      const runner = createPluginRunner([plugin]);

      await expect(
        runner.wrapInvocation!(invocationInfo, () =>
          Promise.resolve(succeededOutput),
        ),
      ).resolves.toEqual(succeededOutput);
    });

    it("runs fn when a wrapper rejects without calling it", async () => {
      const fn = jest.fn(() => Promise.resolve("customer-result"));
      const plugin: DurableInstrumentationPlugin = {
        wrapOperationAttemptFn: async () => {
          throw new Error("wrapper failed before fn");
        },
      };

      const runner = createPluginRunner([plugin]);

      await expect(
        runner.wrapOperationAttemptFn!(attemptInfo, fn),
      ).resolves.toBe("customer-result");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("keeps fn's error when a wrapper rejects with its own error", async () => {
      const originalError = new Error("customer fn error");
      const plugin: DurableInstrumentationPlugin = {
        wrapChildContextFn: async (_info, fn) => {
          await (fn() as Promise<unknown>).catch(() => undefined);
          throw new Error("wrapper error");
        },
      };

      const runner = createPluginRunner([plugin]);

      await expect(
        runner.wrapChildContextFn!(operationInfo, () =>
          Promise.reject(originalError),
        ),
      ).rejects.toThrow(originalError);
    });

    it("still runs the inner wrapper when an outer wrapper rejects before calling it", async () => {
      const innerRan = jest.fn();
      const fn = jest.fn(() => Promise.resolve("customer-result"));
      const outer: DurableInstrumentationPlugin = {
        wrapOperationAttemptFn: async () => {
          throw new Error("outer wrapper failed before next");
        },
      };
      const inner: DurableInstrumentationPlugin = {
        wrapOperationAttemptFn: (_info, next) => {
          innerRan();
          return next();
        },
      };

      const runner = createPluginRunner([outer, inner]);

      await expect(
        runner.wrapOperationAttemptFn!(attemptInfo, fn),
      ).resolves.toBe("customer-result");
      expect(innerRan).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("does not run the inner wrapper twice when an outer wrapper rejects after calling it", async () => {
      const innerRan = jest.fn();
      const fn = jest.fn(() => Promise.resolve("customer-result"));
      const outer: DurableInstrumentationPlugin = {
        wrapOperationAttemptFn: async (_info, next) => {
          await next();
          throw new Error("outer wrapper failed after next");
        },
      };
      const inner: DurableInstrumentationPlugin = {
        wrapOperationAttemptFn: (_info, next) => {
          innerRan();
          return next();
        },
      };

      const runner = createPluginRunner([outer, inner]);

      await expect(
        runner.wrapOperationAttemptFn!(attemptInfo, fn),
      ).resolves.toBe("customer-result");
      expect(innerRan).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledTimes(1);
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
      status: PluginInvocationStatus.SUCCEEDED,
      executionResult: { data: "test" },
      executionInput: { event: "input" },
      operations: {},
      executionStartTimestamp: new Date("2024-01-01T00:00:00Z"),
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
        onOperationStart: jest.fn(),
        onOperationAttemptStart: jest.fn(),
        wrapOperationAttemptFn: jest.fn((_info: any, fn: () => any) => fn()),
        onOperationAttemptEnd: jest.fn(),
        onOperationEnd: jest.fn(),
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
        onOperationStart: jest.fn(),
        onOperationAttemptStart: jest.fn(),
        wrapOperationAttemptFn: jest.fn((_info: any, fn: () => any) => fn()),
        onOperationAttemptEnd: jest.fn(),
        onOperationEnd: jest.fn(),
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
      runner.onOperationStart!(operationInfo);
      runner.onOperationAttemptStart!(attemptInfo);
      runner.wrapOperationAttemptFn!(attemptInfo, () => "attempt-result");
      runner.onOperationAttemptEnd!(attemptEndInfo);
      runner.onOperationEnd!(operationInfo);
      runner.onOperationChange!(operationChangeInfo);
      await runner.onInvocationEnd!(invocationEndInfo);
      const logCtx = runner.enrichLogContext!();

      // Verify all hooks called on both plugins
      expect(plugin1.onInvocationStart).toHaveBeenCalledTimes(1);
      expect(plugin2.onInvocationStart).toHaveBeenCalledTimes(1);
      expect(plugin1.wrapInvocation).toHaveBeenCalledTimes(1);
      expect(plugin2.wrapInvocation).toHaveBeenCalledTimes(1);
      expect(plugin1.onOperationStart).toHaveBeenCalledTimes(1);
      expect(plugin2.onOperationStart).toHaveBeenCalledTimes(1);
      expect(plugin1.onOperationAttemptStart).toHaveBeenCalledTimes(1);
      expect(plugin2.onOperationAttemptStart).toHaveBeenCalledTimes(1);
      expect(plugin1.wrapOperationAttemptFn).toHaveBeenCalledTimes(1);
      expect(plugin2.wrapOperationAttemptFn).toHaveBeenCalledTimes(1);
      expect(plugin1.onOperationAttemptEnd).toHaveBeenCalledTimes(1);
      expect(plugin2.onOperationAttemptEnd).toHaveBeenCalledTimes(1);
      expect(plugin1.onOperationEnd).toHaveBeenCalledTimes(1);
      expect(plugin2.onOperationEnd).toHaveBeenCalledTimes(1);
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
