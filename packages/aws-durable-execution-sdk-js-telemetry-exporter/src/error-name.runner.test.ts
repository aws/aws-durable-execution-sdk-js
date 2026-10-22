/**
 * Table B of the cross-SDK error.name rule, run end to end through the
 * LocalDurableTestRunner: the real SDK hands the real plugin the error shapes
 * it produces, once live and once replayed. "Replayed" means the handler
 * catches the error, waits so that a new invocation starts, and rethrows it, so
 * the failing operation is rebuilt from its checkpoint.
 *
 * Every row asserts that `error.message` is the original message, that the live
 * and replayed names are equal, and that `operationsByName` has the same error
 * as `operations[]`.
 */
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
  /** Operations whose failure was caught and handled, so rule 8 does not apply. */
  handled?: string[];
  /** Fail the callback named "cb" externally with this error. */
  sendFailure?: { ErrorType?: string; ErrorMessage: string };
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
};

class CapturingExporter implements TelemetryExporter {
  readonly records: DurableExecutionTelemetryRecord[] = [];
  async export(record: DurableExecutionTelemetryRecord): Promise<void> {
    this.records.push(structuredClone(record));
  }
}

/**
 * - `live`: the failure reaches the end of the invocation it happened in.
 * - `replayed`: the handler catches it, waits (a new invocation starts) and
 *   rethrows it, with `pluginsConfig.childOperationsDepth: Infinity` so the
 *   later invocation still sees the children of the failed context.
 * - `replayed-default`: the same, with the default depth (no children kept).
 */
type Mode = "live" | "replayed" | "replayed-default";

interface Observed {
  status: string;
  exec?: { name: string; message: string };
  /** The final record's error per operation name. */
  ops: Record<string, { name: string; message: string } | undefined>;
  /** The same, read from operationsByName. */
  opsByName: Record<string, { name: string; message: string } | undefined>;
}

async function observe(row: Row, mode: Mode): Promise<Observed> {
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
        mode === "replayed" ? { childOperationsDepth: Infinity } : undefined,
    },
  );
  const runner = new LocalDurableTestRunner({ handlerFunction: handler });
  runner.registerFunction("payer", async () => {
    throw new PaymentError(MSG);
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
  const opsByName: Observed["opsByName"] = {};
  for (const name of Object.keys(row.ops)) {
    ops[name] = final.operations.find((o) => o.name === name)?.error;
    opsByName[name] = byName[name]?.error;
  }
  return {
    status: String(result.getStatus()),
    exec: final.error,
    ops,
    opsByName,
  };
}

describe.each(Object.entries(TABLE_B))("Table B %s", (_id, row) => {
  const results: Partial<Record<Mode, Observed>> = {};
  const message = row.message ?? MSG;

  describe.each(["live", "replayed"] as const)("%s", (mode) => {
    it(`${row.title}: execution ${row.exec}`, async () => {
      const observed = await observe(row, mode);
      results[mode] = observed;

      expect(observed.status).toBe("FAILED");
      expect(observed.exec).toEqual({ name: row.exec, message });
      for (const [name, expected] of Object.entries(row.ops)) {
        expect({ [name]: observed.ops[name] }).toEqual({
          [name]: { name: expected, message },
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
    expect(results.replayed?.ops).toEqual(results.live?.ops);
  });
});

/**
 * Known limitation, pinned so a change is noticed. When a step fails inside a
 * child context (B4), a map item (B6) or a waitForCallback (B10), the SDK
 * checkpoints the context with the wrapper's type, `StepError`; the user's type
 * is kept only by the failed step inside it. A later invocation sees that step
 * only when `pluginsConfig.childOperationsDepth` preserves it. Without it the
 * replayed execution is named after the checkpointed type.
 */
const LOST_WITHOUT_CHILDREN = new Set(["B4", "B6", "B10"]);

describe.each(Object.entries(TABLE_B))(
  "Table B %s replayed with the default childOperationsDepth",
  (id, row) => {
    it(`${row.title}`, async () => {
      const observed = await observe(row, "replayed-default");
      const expectedName = LOST_WITHOUT_CHILDREN.has(id)
        ? "StepError"
        : row.exec;
      expect(observed.status).toBe("FAILED");
      expect(observed.exec).toEqual({
        name: expectedName,
        message: row.message ?? MSG,
      });
      // Operations the record still carries keep their live name.
      for (const [name, error] of Object.entries(observed.ops)) {
        if (!error) continue;
        expect(observed.opsByName[name]).toEqual(error);
        if (LOST_WITHOUT_CHILDREN.has(id)) {
          expect(error.name).toBe(observed.exec?.name);
        } else {
          expect({ [name]: error.name }).toEqual({ [name]: row.ops[name] });
        }
      }
    });
  },
);
