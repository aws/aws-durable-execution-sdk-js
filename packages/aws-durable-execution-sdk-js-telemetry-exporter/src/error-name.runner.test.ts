/**
 * Table B of the cross-SDK error.name rule, run end to end through the
 * LocalDurableTestRunner: the real SDK hands the real plugin the error shapes
 * it produces, once live and once replayed. "Replayed" means the handler
 * catches the error, waits so that a new invocation starts, and rethrows it, so
 * the failing operation is rebuilt from its checkpoint. Every row runs with the
 * default `pluginsConfig.childOperationsDepth` and with `Infinity`.
 *
 * Every row asserts that `error.message` is the original message, that the live
 * and replayed names are equal, and that `operationsByName` has the same error
 * as `operations[]`.
 */
import { writeFileSync } from "node:fs";
import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import {
  durableExecutionTelemetry,
  withOperationsByName,
  type DurableExecutionTelemetryRecord,
  type TelemetryExporter,
} from "./index";

jest.setTimeout(60_000);

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

class PaymentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PaymentError";
  }
}

class FraudError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FraudError";
  }
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** A user error that carries a Lambda-style `errorType` and an ES2022 cause. */
class LambdaStyleError extends Error {
  readonly errorType = "LambdaStyleError";
  constructor(message: string, cause: Error) {
    super(message, { cause });
    this.name = "LambdaStyleError";
  }
}

const named = (name: string, message: string): Error => {
  const e = new Error(message);
  e.name = name;
  return e;
};

const MSG = "card declined";
const noRetry = { retryStrategy: () => ({ shouldRetry: false }) };

interface Row {
  title: string;
  run: (ctx: DurableContext) => Promise<unknown>;
  /** Expected error.name of each failed operation, by operation name. */
  ops: Record<string, string>;
  exec: string;
  message?: string;
  /**
   * Operations whose failure did not propagate (caught and handled, or a
   * sibling of the failure that did), so rule 8 does not apply.
   */
  handled?: string[];
  /**
   * Operations nested in a context. With the default childOperationsDepth a
   * later invocation does not see them, so a replayed record does not carry
   * them.
   */
  nested?: string[];
  /** Expected operation `error.message`, when it differs from `message`. */
  opMessage?: string;
  /** Fail the callback named "cb" externally with this error. */
  sendFailure?: { ErrorType?: string; ErrorMessage: string };
  /** What the invoked function "payer" throws. */
  invoked?: () => Error;
}

const TABLE_B: Record<string, Row> = {
  B1: {
    title: "a step throws PaymentError",
    run: (ctx) =>
      ctx.step(
        "charge",
        async () => {
          throw new PaymentError(MSG);
        },
        noRetry,
      ),
    ops: { charge: "PaymentError" },
    exec: "PaymentError",
  },
  B2: {
    title: "a step fails once with TypeError, then on retry with PaymentError",
    run: (ctx) =>
      ctx.step(
        "charge",
        async (step) => {
          if (step.attempt === 1) throw new TypeError("transient");
          throw new PaymentError(MSG);
        },
        {
          retryStrategy: (_e, attempt) => ({
            shouldRetry: attempt < 2,
            delay: { seconds: 1 },
          }),
        },
      ),
    ops: { charge: "PaymentError" },
    exec: "PaymentError",
  },
  B3: {
    title: "a child context throws PaymentError",
    run: (ctx) =>
      ctx.runInChildContext("child", async () => {
        throw new PaymentError(MSG);
      }),
    ops: { child: "PaymentError" },
    exec: "PaymentError",
  },
  B4: {
    title: "a child context contains a step that throws PaymentError",
    run: (ctx) =>
      ctx.runInChildContext("child", (child) =>
        child.step(
          "charge",
          async () => {
            throw new PaymentError(MSG);
          },
          noRetry,
        ),
      ),
    ops: { charge: "PaymentError", child: "PaymentError" },
    nested: ["charge"],
    exec: "PaymentError",
  },
  B5: {
    title: "a map item throws PaymentError",
    run: async (ctx) => {
      const result = await ctx.map("fanout", ["a"], async () => {
        throw new PaymentError(MSG);
      });
      result.throwIfError();
    },
    ops: { "map-item-0": "PaymentError" },
    nested: ["map-item-0"],
    exec: "PaymentError",
  },
  B6: {
    title: "a map item's step throws PaymentError",
    run: async (ctx) => {
      const result = await ctx.map("fanout", ["a"], (item) =>
        item.step(
          "item-step",
          async () => {
            throw new PaymentError(MSG);
          },
          noRetry,
        ),
      );
      result.throwIfError();
    },
    ops: { "item-step": "PaymentError", "map-item-0": "PaymentError" },
    nested: ["item-step", "map-item-0"],
    exec: "PaymentError",
  },
  B7: {
    title: "a parallel branch throws PaymentError",
    run: async (ctx) => {
      const result = await ctx.parallel("par", [
        async () => {
          throw new PaymentError(MSG);
        },
      ]);
      result.throwIfError();
    },
    ops: { "parallel-branch-0": "PaymentError" },
    nested: ["parallel-branch-0"],
    exec: "PaymentError",
  },
  B8: {
    title: "a waitForCondition check throws PaymentError",
    run: (ctx) =>
      ctx.waitForCondition(
        "poll",
        async () => {
          throw new PaymentError(MSG);
        },
        { initialState: 0, waitStrategy: () => ({ shouldContinue: false }) },
      ),
    ops: { poll: "PaymentError" },
    exec: "PaymentError",
  },
  B9: {
    title: "an invoked function throws PaymentError",
    run: (ctx) => ctx.invoke("pay", "payer", { amount: 1 }),
    ops: { pay: "PaymentError" },
    exec: "PaymentError",
  },
  "B9-empty-message": {
    title: "an invoked function throws PaymentError with an empty message",
    run: (ctx) => ctx.invoke("pay", "payer", { amount: 1 }),
    invoked: () => new PaymentError(""),
    ops: { pay: "PaymentError" },
    exec: "PaymentError",
    message: "Invoke failed",
    opMessage: "Unknown error",
  },
  B10: {
    title: "the waitForCallback submitter throws PaymentError",
    run: (ctx) =>
      ctx.waitForCallback(
        "wfc",
        async () => {
          throw new PaymentError(MSG);
        },
        { timeout: { seconds: 3600 }, ...noRetry },
      ),
    ops: { wfc: "PaymentError" },
    exec: "PaymentError",
  },
  B11: {
    title: "a callback times out",
    run: async (ctx) => {
      const [promise] = await ctx.createCallback("cb", {
        timeout: { seconds: 1 },
      });
      await promise;
    },
    ops: { cb: "CallbackTimeoutError" },
    exec: "CallbackTimeoutError",
    message: "Callback timed out",
  },
  B12: {
    title: "a callback is failed externally with type PaymentError",
    run: async (ctx) => {
      const [promise] = await ctx.createCallback("cb", {
        timeout: { seconds: 3600 },
      });
      await promise;
    },
    sendFailure: { ErrorType: "PaymentError", ErrorMessage: MSG },
    ops: { cb: "PaymentError" },
    exec: "PaymentError",
  },
  B13: {
    title: "a callback is failed externally with no type",
    run: async (ctx) => {
      const [promise] = await ctx.createCallback("cb", {
        timeout: { seconds: 3600 },
      });
      await promise;
    },
    sendFailure: { ErrorMessage: MSG },
    ops: { cb: "CallbackExternalError" },
    exec: "CallbackExternalError",
  },
  B13b: {
    title: 'a callback is failed externally with type "Error"',
    run: async (ctx) => {
      const [promise] = await ctx.createCallback("cb", {
        timeout: { seconds: 3600 },
      });
      await promise;
    },
    sendFailure: { ErrorType: "Error", ErrorMessage: MSG },
    ops: { cb: "Error" },
    exec: "Error",
  },
  "B13-blank": {
    title: "a callback is failed externally with a blank type",
    run: async (ctx) => {
      const [promise] = await ctx.createCallback("cb", {
        timeout: { seconds: 3600 },
      });
      await promise;
    },
    sendFailure: { ErrorType: " \t", ErrorMessage: MSG },
    ops: { cb: "CallbackExternalError" },
    exec: "CallbackExternalError",
  },
  B14: {
    title: "the handler throws PaymentError, which has its own cause TypeError",
    run: async () => {
      throw new PaymentError(MSG, { cause: new TypeError("inner") });
    },
    ops: {},
    exec: "PaymentError",
  },
  B15: {
    title:
      "the handler throws a user error that has an errorType field and a cause",
    run: async () => {
      throw new LambdaStyleError(MSG, new TypeError("socket hang up"));
    },
    ops: {},
    exec: "LambdaStyleError",
  },
  B16: {
    title:
      "a caught ValueError(x) step, then a child context fails with ValidationError(x)",
    run: async (ctx) => {
      try {
        await ctx.step(
          "check",
          async () => {
            throw named("ValueError", "x");
          },
          noRetry,
        );
      } catch {
        // handled
      }
      await ctx.runInChildContext("child", async () => {
        throw new ValidationError("x");
      });
    },
    ops: { check: "ValueError", child: "ValidationError" },
    handled: ["check"],
    exec: "ValidationError",
    message: "x",
  },
  B17: {
    title: "an SDK-only failure: a map completed as FAILED by shouldComplete",
    run: async (ctx) => {
      const result = await ctx.map("fanout", ["a"], async () => 1, {
        completionConfig: {
          shouldComplete: () => ({
            complete: true,
            outcome: "FAILED" as never,
          }),
        },
      });
      result.throwIfError();
    },
    ops: {},
    exec: "BatchCompletionError",
    message:
      "Batch completed as failed by shouldComplete (CUSTOM_COMPLETION_FAILED)",
  },
  B18: {
    title: "a class named Payment$Error is thrown from a step",
    run: (ctx) =>
      ctx.step(
        "charge",
        async () => {
          throw named("Payment$Error", MSG);
        },
        noRetry,
      ),
    ops: { charge: "Error" },
    exec: "Error",
  },
  B19: {
    title: "context.promise.all over a step that throws PaymentError",
    run: (ctx) =>
      ctx.promise.all("combo", [
        ctx.step(
          "charge",
          async () => {
            throw new PaymentError(MSG);
          },
          noRetry,
        ),
      ]),
    ops: { charge: "PaymentError", combo: "PaymentError" },
    exec: "PaymentError",
  },
  "B19-race": {
    title: "context.promise.race over a step that throws PaymentError",
    run: (ctx) =>
      ctx.promise.race("combo", [
        ctx.step(
          "charge",
          async () => {
            throw new PaymentError(MSG);
          },
          noRetry,
        ),
      ]),
    ops: { charge: "PaymentError", combo: "PaymentError" },
    exec: "PaymentError",
  },
  B20: {
    title:
      "two map items' steps fail with the same message: PaymentError, FraudError",
    run: async (ctx) => {
      const result = await ctx.map(
        "fanout",
        ["a", "b"],
        (item, value) =>
          item.step(
            `step-${value}`,
            async () => {
              throw value === "a" ? new PaymentError(MSG) : new FraudError(MSG);
            },
            noRetry,
          ),
        { completionConfig: { toleratedFailureCount: 1 } },
      );
      result.throwIfError();
    },
    ops: {
      "step-a": "PaymentError",
      "step-b": "FraudError",
      "map-item-0": "PaymentError",
      "map-item-1": "FraudError",
    },
    // throwIfError raises the first failed item: item 0.
    handled: ["step-b", "map-item-1"],
    nested: ["step-a", "step-b", "map-item-0", "map-item-1"],
    exec: "PaymentError",
  },
  B21: {
    title:
      "two parallel branches' steps fail with the same message: PaymentError, FraudError",
    run: async (ctx) => {
      const result = await ctx.parallel(
        "par",
        [
          (branch) =>
            branch.step(
              "step-a",
              async () => {
                throw new PaymentError(MSG);
              },
              noRetry,
            ),
          (branch) =>
            branch.step(
              "step-b",
              async () => {
                throw new FraudError(MSG);
              },
              noRetry,
            ),
        ],
        { completionConfig: { toleratedFailureCount: 1 } },
      );
      result.throwIfError();
    },
    ops: {
      "step-a": "PaymentError",
      "step-b": "FraudError",
      "parallel-branch-0": "PaymentError",
      "parallel-branch-1": "FraudError",
    },
    // throwIfError raises the first failed branch: branch 0.
    handled: ["step-b", "parallel-branch-1"],
    nested: ["step-a", "step-b", "parallel-branch-0", "parallel-branch-1"],
    exec: "PaymentError",
  },
};

/**
 * Shapes outside Table B that a heuristic exporter got wrong. The core SDK now
 * checkpoints each failed context with the wrapped error, so they need nothing
 * special.
 */
const EXTRA_ROWS: Record<string, Row> = {
  "X1-child-awaits-map": {
    title:
      "a child context awaits a map whose item's step throws, then throwIfError",
    run: (ctx) =>
      ctx.runInChildContext("child", async (child) => {
        const result = await child.map("fanout", ["a"], (item) =>
          item.step(
            "item-step",
            async () => {
              throw new PaymentError(MSG);
            },
            noRetry,
          ),
        );
        result.throwIfError();
      }),
    ops: {
      "item-step": "PaymentError",
      "map-item-0": "PaymentError",
      child: "PaymentError",
    },
    nested: ["item-step", "map-item-0"],
    exec: "PaymentError",
  },
  "X2-staggered-combinator": {
    title: "promise.all over a step started before an earlier awaited step",
    run: async (ctx) => {
      const charge = ctx.step(
        "charge",
        async () => {
          await new Promise((r) => setTimeout(r, 50));
          throw new PaymentError(MSG);
        },
        noRetry,
      );
      await ctx.step("prepare", async () => 1);
      await ctx.promise.all("combo", [charge]);
    },
    ops: { charge: "PaymentError", combo: "PaymentError" },
    exec: "PaymentError",
  },
  "X3-handled-context-then-map": {
    title:
      "a handled child context fails with PaymentError, then a map item with FraudError (same message)",
    run: async (ctx) => {
      await ctx
        .runInChildContext("refund", (child) =>
          child.step(
            "refund-step",
            async () => {
              throw new PaymentError(MSG);
            },
            noRetry,
          ),
        )
        .catch(() => undefined);
      const result = await ctx.map("fanout", ["a"], (item) =>
        item.step(
          "item-step",
          async () => {
            throw new FraudError(MSG);
          },
          noRetry,
        ),
      );
      result.throwIfError();
    },
    ops: {
      refund: "PaymentError",
      "item-step": "FraudError",
      "map-item-0": "FraudError",
    },
    handled: ["refund"],
    nested: ["item-step", "map-item-0"],
    exec: "FraudError",
  },
};

class CapturingExporter implements TelemetryExporter {
  readonly records: DurableExecutionTelemetryRecord[] = [];
  async export(record: DurableExecutionTelemetryRecord): Promise<void> {
    this.records.push(structuredClone(record));
  }
}

type Depth = "default" | "Infinity";

interface Observed {
  status: string;
  exec?: { name: string; message: string };
  /** The final record's error per operation name. */
  ops: Record<string, { name: string; message: string } | undefined>;
  /** Whether the final record carries the operation at all. */
  present: Record<string, boolean>;
  /** The same, read from operationsByName. */
  opsByName: Record<string, { name: string; message: string } | undefined>;
}

/**
 * - `live`: the failure reaches the end of the invocation it happened in.
 * - `replayed`: the handler catches it, waits (a new invocation starts) and
 *   rethrows it, so it is rebuilt from the checkpoint.
 */
type Mode = "live" | "replayed";

async function observe(row: Row, mode: Mode, depth: Depth): Promise<Observed> {
  const exporter = new CapturingExporter();
  const telemetry = durableExecutionTelemetry({
    exporters: [exporter],
    emitMode: "on-complete",
    operationDetail: "full-tree",
  });
  const handler = withDurableExecution(
    async (_event: unknown, ctx: DurableContext) => {
      if (mode === "live") return row.run(ctx);
      try {
        return await row.run(ctx);
      } catch (error) {
        await ctx.wait("pause", { seconds: 1 });
        throw error;
      }
    },
    {
      plugins: [telemetry],
      pluginsConfig:
        depth === "Infinity" ? { childOperationsDepth: Infinity } : undefined,
    },
  );
  const runner = new LocalDurableTestRunner({ handlerFunction: handler });
  runner.registerFunction("payer", async () => {
    throw row.invoked ? row.invoked() : new PaymentError(MSG);
  });
  const pending = runner.run({ payload: {} });
  if (row.sendFailure) {
    const callback = runner.getOperation("cb");
    await callback.waitForData(WaitingOperationStatus.STARTED);
    await callback.sendCallbackFailure(row.sendFailure);
  }
  const result = await pending;

  const final = exporter.records.at(-1);
  if (!final) throw new Error("no record exported");
  const byName = withOperationsByName(final).operationsByName;
  const ops: Observed["ops"] = {};
  const present: Observed["present"] = {};
  const opsByName: Observed["opsByName"] = {};
  for (const name of Object.keys(row.ops)) {
    const record = final.operations.find((o) => o.name === name);
    present[name] = record !== undefined;
    ops[name] = record?.error;
    opsByName[name] = byName[name]?.error;
  }
  return {
    status: String(result.getStatus()),
    exec: final.error,
    ops,
    present,
    opsByName,
  };
}

/** Observed names, by row, depth and mode, for the summary grid. */
const grid: Record<string, Record<string, string>> = {};

afterAll(() => {
  if (process.env.TABLE_B_GRID) {
    writeFileSync(process.env.TABLE_B_GRID, JSON.stringify(grid, null, 2));
  }
});

describe.each(Object.entries({ ...TABLE_B, ...EXTRA_ROWS }))(
  "Table B %s",
  (id, row) => {
    describe.each(["default", "Infinity"] as const)(
      "childOperationsDepth %s",
      (depth) => {
        const results: Partial<Record<Mode, Observed>> = {};
        const message = row.message ?? MSG;
        const opMessage = row.opMessage ?? message;

        describe.each(["live", "replayed"] as const)("%s", (mode) => {
          it(`${row.title}: execution ${row.exec}`, async () => {
            const observed = await observe(row, mode, depth);
            results[mode] = observed;
            grid[id] ??= {};
            grid[id][`${depth}/${mode}`] = [
              `exec=${observed.exec?.name}`,
              ...Object.entries(observed.ops).map(([name, error]) =>
                observed.present[name]
                  ? `${name}=${error?.name}`
                  : `${name}=(not in record)`,
              ),
            ].join(" ");

            expect(observed.status).toBe("FAILED");
            expect(observed.exec).toEqual({ name: row.exec, message });
            // A later invocation sees a context's children only within the
            // configured depth; a replayed record then does not carry them.
            const carried = (name: string) =>
              mode === "live" ||
              depth === "Infinity" ||
              !row.nested?.includes(name);
            for (const [name, expected] of Object.entries(row.ops)) {
              expect({ [name]: observed.present[name] }).toEqual({
                [name]: carried(name),
              });
              if (!carried(name)) continue;
              expect({ [name]: observed.ops[name] }).toEqual({
                [name]: { name: expected, message: opMessage },
              });
              expect(observed.opsByName[name]).toEqual(observed.ops[name]);
              // Rule 8: the execution names the error of the operation it came from.
              if (!row.handled?.includes(name)) {
                expect({ [name]: observed.ops[name]?.name }).toEqual({
                  [name]: observed.exec?.name,
                });
              }
            }
          });
        });

        if (row.exec.includes("Timeout")) {
          it("still matches the telemetry-core few-shot query error.name like /Timeout/", () => {
            expect(results.live?.exec?.name).toMatch(/Timeout/);
            for (const error of Object.values(results.live?.ops ?? {})) {
              expect(error?.name).toMatch(/Timeout/);
            }
          });
        }

        it("names the failure the same live and replayed", () => {
          expect(results.live).toBeDefined();
          expect(results.replayed).toBeDefined();
          expect(results.replayed?.exec).toEqual(results.live?.exec);
          for (const [name, error] of Object.entries(
            results.replayed?.ops ?? {},
          )) {
            if (results.replayed?.present[name]) {
              expect({ [name]: error }).toEqual({
                [name]: results.live?.ops[name],
              });
            }
          }
        });
      },
    );
  },
);

/** Rows outside Table B, pinned so a change is noticed. */
describe("outside Table B", () => {
  const failingStep = (ctx: DurableContext) =>
    ctx.step(
      "charge",
      async () => {
        throw new PaymentError(MSG);
      },
      noRetry,
    );

  /**
   * `promise.any` rejects with an `AggregateError`, which is not an SDK
   * wrapper, so it is the name (rule 2). The step keeps its own type.
   */
  it.each(["live", "replayed"] as const)(
    "context.promise.any (%s): combinator and execution AggregateError",
    async (mode) => {
      const observed = await observe(
        {
          title: "promise.any",
          run: (ctx) => ctx.promise.any("combo", [failingStep(ctx)]),
          ops: { charge: "", combo: "" },
          exec: "",
        },
        mode,
        "default",
      );
      expect(observed.status).toBe("FAILED");
      expect(observed.exec?.name).toBe("AggregateError");
      expect(observed.ops.combo?.name).toBe("AggregateError");
      expect(observed.ops.charge).toEqual({
        name: "PaymentError",
        message: MSG,
      });
    },
  );

  /** `promise.allSettled` never rejects, so nothing is named after it. */
  it("context.promise.allSettled: the execution does not fail", async () => {
    const observed = await observe(
      {
        title: "promise.allSettled",
        run: async (ctx) => {
          await ctx.promise.allSettled("combo", [failingStep(ctx)]);
        },
        ops: { charge: "", combo: "" },
        exec: "",
      },
      "live",
      "default",
    );
    expect(observed.status).toBe("SUCCEEDED");
    expect(observed.exec).toBeUndefined();
    expect(observed.ops.combo).toBeUndefined();
    expect(observed.ops.charge).toEqual({ name: "PaymentError", message: MSG });
  });
});
