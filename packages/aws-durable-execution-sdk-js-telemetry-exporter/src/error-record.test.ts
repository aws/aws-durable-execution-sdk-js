import {
  ChildContextError,
  DurableOperationError,
  StepError,
  type InvocationEndInfo,
  type InvocationInfo,
  type OperationInfo,
} from "@aws/durable-execution-sdk-js";
import { runInNewContext } from "node:vm";
import { durableExecutionTelemetry, LambdaLogExporter } from "./index";
import {
  applyOperationsFormat,
  withOperationsByName,
} from "./operations-index";
import { truncateRecord } from "./truncation";
import type {
  ContentConfig,
  DurableExecutionTelemetryRecord,
  ErrorRecord,
  TelemetryExporter,
} from "./types";

/**
 * The error shape written for the execution error, `operations[].error`, and
 * `operationsByName.<name>.error`: `{ name, message, cause? }`, in that key
 * order, with `cause` following `Error.cause`.
 */

const ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:fn:1/durable-execution/exec-1/inv-1";

class CapturingExporter implements TelemetryExporter {
  records: DurableExecutionTelemetryRecord[] = [];
  async export(record: DurableExecutionTelemetryRecord): Promise<void> {
    this.records.push(record);
  }
}

function op(partial: Partial<OperationInfo> & { id: string }): OperationInfo {
  return { type: "STEP", isReplay: false, ...partial } as OperationInfo;
}

/** Runs one FAILED invocation through the plugin and returns its record. */
async function failedRecord(args: {
  executionError?: Error;
  operations?: Record<string, OperationInfo>;
  content?: ContentConfig;
  operationDetail?: "full-tree" | "top-level";
}): Promise<DurableExecutionTelemetryRecord> {
  const exporter = new CapturingExporter();
  const factory = durableExecutionTelemetry({
    exporters: [exporter],
    emitMode: "on-complete",
    content: args.content,
    operationDetail: args.operationDetail,
  });
  const end = {
    executionArn: ARN,
    requestId: "req-1",
    isFirstInvocation: true,
    status: "FAILED",
    executionInput: undefined,
    executionError: args.executionError,
    operations: args.operations ?? {},
  } as InvocationEndInfo;
  const plugin = factory.createPlugin({
    ...end,
    updatedOperations: {},
  } as unknown as InvocationInfo);
  await plugin.onInvocationEnd?.(end);
  expect(exporter.records).toHaveLength(1);
  return exporter.records[0];
}

/** An error named `name`, with an optional cause. */
function named(name: string, message: string, cause?: unknown): Error {
  const e = new Error(message, cause === undefined ? undefined : { cause });
  e.name = name;
  return e;
}

/** A chain of `levels` causes below a top-level error. */
function chain(levels: number): Error {
  let cause: Error | undefined;
  for (let i = levels; i >= 1; i--) cause = named(`Cause${i}`, `c${i}`, cause);
  return named("TopError", "top", cause);
}

/**
 * True when `s` has no lone surrogate. Uses `String.prototype.isWellFormed`
 * (Node 20+) when present, and an equivalent check otherwise.
 */
function wellFormed(s: string): boolean {
  const native = (s as { isWellFormed?: () => boolean }).isWellFormed;
  if (typeof native === "function") return native.call(s);
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
    s,
  );
}

/** Number of code points in `s`. */
function codePoints(s: string): number {
  return [...s].length;
}

/** Number of `cause` levels below `error`. */
function depth(error: ErrorRecord | undefined): number {
  let n = 0;
  for (let c = error?.cause; c !== undefined; c = c.cause) n++;
  return n;
}

describe("error records", () => {
  it("writes name, message, cause in that key order and keeps the name unchanged", async () => {
    const rec = await failedRecord({
      executionError: named(
        "StepError",
        "payment failed",
        named("PaymentError", "card declined"),
      ),
    });

    expect(rec.error).toEqual({
      name: "StepError",
      message: "payment failed",
      cause: { name: "PaymentError", message: "card declined" },
    });
    expect(JSON.stringify(rec.error)).toBe(
      '{"name":"StepError","message":"payment failed","cause":{"name":"PaymentError","message":"card declined"}}',
    );
  });

  it("omits the cause key when the error has none, so the shape stays { name, message }", async () => {
    const rec = await failedRecord({
      executionError: named("TypeError", "boom"),
    });
    expect(Object.keys(rec.error ?? {})).toEqual(["name", "message"]);
    expect(JSON.stringify(rec.error)).toBe(
      '{"name":"TypeError","message":"boom"}',
    );
  });

  it("keeps the record readable by the existing CloudWatch Logs Insights parse patterns", async () => {
    // telemetry-core's Lambda log queries parse
    //   "error":{"name":"*"   and   "error":{"name":"*","message":"*"
    // from the raw JSON line, so `name` and `message` must stay first.
    const rec = await failedRecord({
      executionError: named("StepError", "failed", new Error("inner")),
    });
    const line = JSON.stringify(new LambdaLogExporter().render(rec));
    expect(line).toContain('"error":{"name":"StepError","message":"failed",');
  });

  it.each([
    [1, 1],
    [16, 16],
    [17, 16],
  ])(
    "writes a chain of %i cause level(s) as %i level(s)",
    async (levels, written) => {
      const rec = await failedRecord({ executionError: chain(levels) });
      expect(depth(rec.error)).toBe(written);
      let c = rec.error?.cause;
      for (let i = 1; i <= written; i++) {
        expect(c).toMatchObject({ name: `Cause${i}`, message: `c${i}` });
        c = c?.cause;
      }
    },
  );

  it("stops a cycle at the cause already written", async () => {
    const a = named("AError", "a");
    const b = named("BError", "b", a);
    (a as { cause?: unknown }).cause = b;
    const rec = await failedRecord({ executionError: a });
    expect(rec.error).toEqual({
      name: "AError",
      message: "a",
      cause: { name: "BError", message: "b" },
    });
  });

  it("stops at an error that is its own cause", async () => {
    const self = named("SelfError", "self");
    (self as { cause?: unknown }).cause = self;
    const rec = await failedRecord({ executionError: self });
    expect(rec.error).toEqual({ name: "SelfError", message: "self" });
  });

  it.each([
    ["a string", "disk full", "disk full"],
    ["a number", 42, "42"],
    ["a plain object", { code: 7 }, "[object Object]"],
  ])(
    "writes %s cause as { name: 'Error', message: String(cause) }",
    async (_label, cause, message) => {
      const rec = await failedRecord({
        executionError: named("StepError", "failed", cause),
      });
      expect(rec.error?.cause).toEqual({ name: "Error", message });
    },
  );

  it("writes a non-error cause whose toString throws without losing the record", async () => {
    const cause = {
      toString(): string {
        throw new Error("toString blew up");
      },
    };
    const rec = await failedRecord({
      executionError: named("StepError", "failed", cause),
    });
    expect(rec.error).toEqual({
      name: "StepError",
      message: "failed",
      cause: { name: "Error", message: "[object Object]" },
    });
  });

  it("writes a null-prototype cause, which String() cannot convert", async () => {
    const rec = await failedRecord({
      executionError: named("StepError", "failed", Object.create(null)),
    });
    expect(rec.error?.cause).toEqual({
      name: "Error",
      message: "[object Object]",
    });
  });

  it("ends the chain at a cause whose getters throw, keeping the record", async () => {
    const poisoned = new Error("x");
    Object.defineProperty(poisoned, "message", {
      get(): string {
        throw new Error("message getter blew up");
      },
    });
    const throwingCause = new Error("y");
    Object.defineProperty(throwingCause, "cause", {
      get(): unknown {
        throw new Error("cause getter blew up");
      },
    });

    const a = await failedRecord({
      executionError: named("StepError", "failed", poisoned),
    });
    expect(a.error).toEqual({ name: "StepError", message: "failed" });

    const b = await failedRecord({
      executionError: named("StepError", "failed", throwingCause),
    });
    expect(b.error).toEqual({
      name: "StepError",
      message: "failed",
      cause: { name: "Error", message: "y" },
    });
  });

  it("treats an error from another realm as an error object", async () => {
    const foreign = runInNewContext(
      'const e = new TypeError("from vm"); e;',
    ) as Error;
    expect(foreign instanceof Error).toBe(false);
    const rec = await failedRecord({
      executionError: named("StepError", "failed", foreign),
    });
    expect(rec.error?.cause).toEqual({ name: "TypeError", message: "from vm" });
  });

  it("writes the cause of an operation error rebuilt from a checkpoint", async () => {
    // The exact rebuild the SDK does for a checkpointed operation error
    // (toOperationInfo → DurableOperationError.fromErrorObject): a StepError
    // whose cause carries the checkpointed ErrorType and ErrorMessage.
    const rebuilt = DurableOperationError.fromErrorObject({
      ErrorType: "StepError",
      ErrorMessage: "card declined",
      StackTrace: ["PaymentError: card declined", "    at charge"],
    });
    expect(rebuilt).toBeInstanceOf(StepError);

    const rec = await failedRecord({
      executionError: rebuilt,
      operations: {
        o1: op({
          id: "o1",
          name: "charge",
          status: "FAILED",
          error: rebuilt,
        }),
      },
    });

    const expected = {
      name: "StepError",
      message: "card declined",
      cause: { name: "StepError", message: "card declined" },
    };
    expect(rec.error).toEqual(expected);
    expect(rec.operations[0].error).toEqual(expected);
    expect(withOperationsByName(rec).operationsByName.charge.error).toEqual(
      expected,
    );
  });

  it("writes the cause chain for operations[].error and operationsByName.<name>.error", async () => {
    const error = named(
      "StepError",
      "charge failed",
      named("PaymentError", "card declined", "gateway 402"),
    );
    const rec = await failedRecord({
      operations: {
        o1: op({ id: "o1", name: "charge", status: "FAILED", error }),
      },
    });
    const expected = {
      name: "StepError",
      message: "charge failed",
      cause: {
        name: "PaymentError",
        message: "card declined",
        cause: { name: "Error", message: "gateway 402" },
      },
    };
    expect(rec.operations[0].error).toEqual(expected);

    const rendered = withOperationsByName(rec);
    expect(rendered.operationsByName.charge.error).toEqual(expected);
    expect(JSON.stringify(rendered.operationsByName.charge.error)).toBe(
      JSON.stringify(expected),
    );
  });

  it("includeErrors: false removes operation errors with their causes", async () => {
    const error = named("StepError", "failed", named("Inner", "inner"));
    const rec = await failedRecord({
      executionError: error,
      operations: {
        o1: op({ id: "o1", name: "charge", status: "FAILED", error }),
      },
      content: { operations: { includeErrors: false } },
    });
    expect(rec.operations[0].error).toBeUndefined();
    expect(withOperationsByName(rec).operationsByName.charge.error).toBe(
      undefined,
    );
    expect(JSON.stringify(rec.operations)).not.toContain("Inner");
    // includeErrors governs operation errors only; the execution error stays,
    // as it did before causes were written.
    expect(rec.error?.cause).toEqual({ name: "Inner", message: "inner" });
  });

  it("ends the chain at a revoked proxy cause, keeping the record", async () => {
    const { proxy, revoke } = Proxy.revocable(new Error("gone"), {});
    revoke();
    const rec = await failedRecord({
      executionError: named("StepError", "failed", proxy),
    });
    expect(rec.error).toEqual({ name: "StepError", message: "failed" });
  });

  it("ends the chain at a cause whose Symbol.toStringTag getter throws, keeping the record", async () => {
    const cause = {
      get [Symbol.toStringTag](): string {
        throw new Error("tag getter");
      },
    };
    const rec = await failedRecord({
      executionError: named(
        "StepError",
        "failed",
        named("Inner", "inner", cause),
      ),
    });
    expect(rec.error).toEqual({
      name: "StepError",
      message: "failed",
      cause: { name: "Inner", message: "inner" },
    });
  });

  it("writes a cause whose name is missing with name 'Error'", async () => {
    const cause = new Error("n");
    Object.defineProperty(cause, "name", { value: undefined });
    const rec = await failedRecord({
      executionError: named("StepError", "failed", cause),
    });
    expect(rec.error?.cause).toEqual({ name: "Error", message: "n" });
    expect(Object.keys(rec.error?.cause ?? {})).toEqual(["name", "message"]);
  });

  it("converts a non-string cause name and message to strings", async () => {
    const cause = {
      [Symbol.toStringTag]: "Error",
      name: { nested: 1 },
      message: 42,
    };
    const rec = await failedRecord({
      executionError: named("StepError", "failed", cause),
    });
    expect(rec.error?.cause).toEqual({
      name: "[object Object]",
      message: "42",
    });
  });

  it("caps every message, on errors and on causes, at 8,192 code points plus '…'", async () => {
    const long = "m".repeat(10_000);
    const capped = `${"m".repeat(8192)}…`;
    const error = named("StepError", long, named("Inner", long, long));
    const rec = await failedRecord({
      executionError: error,
      operations: {
        o1: op({ id: "o1", name: "charge", status: "FAILED", error }),
      },
    });
    const expected = {
      name: "StepError",
      message: capped,
      cause: {
        name: "Inner",
        message: capped,
        cause: { name: "Error", message: capped },
      },
    };
    expect(rec.error).toEqual(expected);
    expect(rec.operations[0].error).toEqual(expected);
    expect(withOperationsByName(rec).operationsByName.charge.error).toEqual(
      expected,
    );
  });

  it("keeps a message of exactly 8,192 code points unchanged", async () => {
    const exact = "m".repeat(8192);
    const rec = await failedRecord({
      executionError: named("StepError", exact, named("Inner", exact)),
    });
    expect(rec.error?.message).toBe(exact);
    expect(rec.error?.cause?.message).toBe(exact);
  });

  it("counts code points, so a cut never splits a surrogate pair", async () => {
    // 8,193 code points in 8,195 UTF-16 units: the 8,192nd code point is the
    // first emoji, so the cut lands between the two emoji, not inside one.
    const text = `${"a".repeat(8191)}😀😀`;
    const rec = await failedRecord({
      executionError: named("StepError", text, named(text, text)),
    });
    const expected = `${"a".repeat(8191)}😀…`;
    for (const value of [
      rec.error?.message,
      rec.error?.cause?.name,
      rec.error?.cause?.message,
    ]) {
      expect(value).toBe(expected);
      expect(wellFormed(value ?? "")).toBe(true);
    }
  });

  it("keeps 8,192 emoji of a 9,000-emoji message (code points, not UTF-16 units)", async () => {
    const text = "😀".repeat(9000);
    const rec = await failedRecord({
      executionError: named("StepError", text, named("Inner", text)),
    });
    const expected = `${"😀".repeat(8192)}…`;
    for (const value of [rec.error?.message, rec.error?.cause?.message]) {
      expect(value).toBe(expected);
      expect(codePoints(value ?? "")).toBe(8193);
      expect(wellFormed(value ?? "")).toBe(true);
    }
  });

  it("keeps a value of 8,192 code points but more UTF-16 units unchanged", async () => {
    const text = `${"a".repeat(8191)}😀`; // 8,193 units, 8,192 code points
    const rec = await failedRecord({
      executionError: named(text, text),
    });
    expect(rec.error).toEqual({ name: text, message: text });
  });

  it("caps a 70,000-character name on errors and on causes", async () => {
    const long = "N".repeat(70_000);
    const capped = `${"N".repeat(8192)}…`;
    const error = named(long, "failed", named(long, "inner"));
    const rec = await failedRecord({
      executionError: error,
      operations: {
        o1: op({ id: "o1", name: "charge", status: "FAILED", error }),
      },
    });
    const expected = {
      name: capped,
      message: "failed",
      cause: { name: capped, message: "inner" },
    };
    expect(rec.error).toEqual(expected);
    expect(rec.operations[0].error).toEqual(expected);
    expect(withOperationsByName(rec).operationsByName.charge.error).toEqual(
      expected,
    );
  });

  it("writes the root error as { name: 'Error', message: '' } when its getters throw, keeping the record and its cause", async () => {
    const throwingName = new Error("m", { cause: named("Inner", "inner") });
    Object.defineProperty(throwingName, "name", {
      get(): string {
        throw new Error("name getter blew up");
      },
    });
    const a = await failedRecord({ executionError: throwingName });
    expect(a.error).toEqual({
      name: "Error",
      message: "",
      cause: { name: "Inner", message: "inner" },
    });

    const throwingMessage = new Error("m");
    Object.defineProperty(throwingMessage, "message", {
      get(): string {
        throw new Error("message getter blew up");
      },
    });
    const b = await failedRecord({
      executionError: throwingMessage,
      operations: {
        o1: op({
          id: "o1",
          name: "charge",
          status: "FAILED",
          error: throwingMessage,
        }),
      },
    });
    expect(b.error).toEqual({ name: "Error", message: "" });
    expect(b.operations[0].error).toEqual({ name: "Error", message: "" });
  });

  it("converts a non-string root name and message to strings, and caps them", async () => {
    const root = new Error("x");
    Object.defineProperty(root, "name", { value: { nested: 1 } });
    Object.defineProperty(root, "message", { value: 42 });
    const rec = await failedRecord({ executionError: root });
    expect(rec.error).toEqual({ name: "[object Object]", message: "42" });

    const missing = new Error("x");
    Object.defineProperty(missing, "name", { value: undefined });
    Object.defineProperty(missing, "message", { value: null });
    const rec2 = await failedRecord({ executionError: missing });
    expect(rec2.error).toEqual({ name: "Error", message: "" });
  });

  it("ends the chain at a cause whose name getter throws, keeping the record", async () => {
    const cause = new Error("y");
    Object.defineProperty(cause, "name", {
      get(): string {
        throw new Error("name getter blew up");
      },
    });
    const rec = await failedRecord({
      executionError: named(
        "StepError",
        "failed",
        named("Inner", "inner", cause),
      ),
    });
    expect(rec.error).toEqual({
      name: "StepError",
      message: "failed",
      cause: { name: "Inner", message: "inner" },
    });
  });

  it("stops an infinite chain of distinct causes at 16 levels", async () => {
    let calls = 0;
    const endless = (n: number): Error => {
      const e = named(`Cause${n}`, `c${n}`);
      Object.defineProperty(e, "cause", {
        get(): Error {
          calls++;
          return endless(n + 1);
        },
      });
      return e;
    };
    const top = named("TopError", "top");
    Object.defineProperty(top, "cause", {
      get(): Error {
        calls++;
        return endless(1);
      },
    });
    const rec = await failedRecord({ executionError: top });
    expect(depth(rec.error)).toBe(16);
    let c = rec.error?.cause;
    for (let i = 1; i <= 16; i++) {
      expect(c).toMatchObject({ name: `Cause${i}`, message: `c${i}` });
      c = c?.cause;
    }
    // One read for the root and one per written level; nothing below 16.
    expect(calls).toBe(17);
  });

  it("writes levels that repeat the level above (no dedupe)", async () => {
    const rec = await failedRecord({
      executionError: named(
        "StepError",
        "same",
        named("StepError", "same", named("StepError", "same")),
      ),
    });
    expect(depth(rec.error)).toBe(2);
  });

  it("truncation first removes every cause and sets droppedCauses, keeping the operations", async () => {
    const rec = await failedRecord({
      executionError: named("StepError", "failed", named("Inner", "dropped")),
      operations: {
        o1: op({
          id: "o1",
          name: "charge",
          status: "FAILED",
          startTimestamp: new Date("2026-01-01T00:00:00.000Z"),
          error: named("StepError", "x", named("Big", "y".repeat(2000))),
        }),
      },
    });
    const full = JSON.stringify(rec).length;
    const cut = truncateRecord(rec, full - 100);
    expect(cut.truncated).toBe(true);
    expect(cut.droppedCauses).toBe(true);
    expect(cut.droppedOperations).toBeUndefined();
    expect(JSON.stringify(cut.error)).toBe(
      '{"name":"StepError","message":"failed"}',
    );
    expect(cut.operations[0].error).toEqual({
      name: "StepError",
      message: "x",
    });
    expect(JSON.stringify(cut)).not.toContain("Big");
    // The shared input record is not mutated.
    expect(rec.error?.cause).toEqual({ name: "Inner", message: "dropped" });
    expect(rec.operations[0].error?.cause?.name).toBe("Big");
  });

  it.each(["both", "by-name"] as const)(
    "truncation with operationsFormat %s removes causes from operationsByName too",
    async (format) => {
      const rec = await failedRecord({
        executionError: named("StepError", "failed", named("Inner", "dropped")),
        operations: {
          o1: op({
            id: "o1",
            name: "charge",
            status: "FAILED",
            startTimestamp: new Date("2026-01-01T00:00:00.000Z"),
            error: named("StepError", "x", named("Big", "y".repeat(2000))),
          }),
        },
      });
      const render = (r: DurableExecutionTelemetryRecord): unknown =>
        applyOperationsFormat(r, format);
      const size = (v: unknown): number => Buffer.byteLength(JSON.stringify(v));
      const full = size(render(rec));
      const cut = truncateRecord(rec, full - 1, render);
      const rendered = render(cut) as {
        operations?: unknown;
        operationsByName: Record<string, { error?: ErrorRecord }>;
      };
      expect(size(rendered)).toBeLessThanOrEqual(full - 1);
      expect(cut.truncated).toBe(true);
      expect(cut.droppedCauses).toBe(true);
      expect(cut.droppedOperations).toBeUndefined();
      expect(rendered.operationsByName.charge.error).toEqual({
        name: "StepError",
        message: "x",
      });
      expect(rendered.operations !== undefined).toBe(format === "both");
      expect(JSON.stringify(rendered)).not.toContain('"cause"');
    },
  );

  it("does not set droppedCauses on an over-limit record that has no causes", async () => {
    const rec = await failedRecord({
      executionError: named("StepError", "failed"),
      operations: {
        o1: op({
          id: "o1",
          name: "old",
          status: "FAILED",
          startTimestamp: new Date("2026-01-01T00:00:00.000Z"),
          error: named("StepError", "y".repeat(2000)),
        }),
        o2: op({
          id: "o2",
          name: "new",
          status: "FAILED",
          startTimestamp: new Date("2026-01-01T00:00:01.000Z"),
          error: named("StepError", "z"),
        }),
      },
    });
    const full = Buffer.byteLength(JSON.stringify(rec));
    const cut = truncateRecord(rec, full - 100);
    expect(cut.truncated).toBe(true);
    expect(cut.droppedCauses).toBeUndefined();
    expect("droppedCauses" in cut).toBe(false);
    expect(cut.droppedOperations).toBe(1);
    expect(cut.operations.map((o) => o.name)).toEqual(["new"]);
  });

  it("does not set droppedCauses when the record fits", async () => {
    const rec = await failedRecord({
      executionError: named("StepError", "failed", named("Inner", "kept")),
    });
    const out = truncateRecord(rec, 256_000);
    expect(out).toBe(rec);
    expect(out.droppedCauses).toBeUndefined();
  });

  it("caps nested child-context errors with 60 KB messages so the record stays under the limit untruncated", async () => {
    // The shapes the SDK produces for three nested child contexts around a
    // step that throws a 60 KB message: each context error wraps the step
    // error, which wraps the thrown error, and every level copies the message.
    const big = "x".repeat(60_000);
    const contextError = (): Error =>
      new ChildContextError(big, new StepError(big, new Error(big)));
    const at = (s: number): Date => new Date(`2026-01-01T00:00:0${s}.000Z`);
    const rec2Ops = (): Record<string, OperationInfo> => ({
      c1: op({
        id: "c1",
        name: "outer",
        type: "CONTEXT",
        status: "FAILED",
        startTimestamp: at(1),
        error: contextError(),
      }),
      c2: op({
        id: "c2",
        name: "mid",
        type: "CONTEXT",
        parentId: "c1",
        status: "FAILED",
        startTimestamp: at(2),
        error: contextError(),
      }),
      c3: op({
        id: "c3",
        name: "inner",
        type: "CONTEXT",
        parentId: "c2",
        status: "FAILED",
        startTimestamp: at(3),
        error: contextError(),
      }),
      s1: op({
        id: "s1",
        name: "pay",
        parentId: "c3",
        status: "FAILED",
        startTimestamp: at(4),
        error: new StepError(big, new Error(big)),
      }),
    });
    const rec = await failedRecord({
      executionError: contextError(),
      operations: rec2Ops(),
    });

    const exporter = new LambdaLogExporter();
    const out = truncateRecord(
      rec,
      exporter.maxRecordSizeBytes,
      exporter.render,
    );
    const line = JSON.stringify(exporter.render(out));
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(256_000);
    // The cap alone keeps the record under the limit: truncation is a no-op.
    expect(out).toBe(rec);
    expect(out.truncated).toBeUndefined();
    expect(out.droppedCauses).toBeUndefined();
    expect(out.droppedOperations).toBeUndefined();
    // The default operationDetail keeps top-level operations only, so the
    // failing operation in the record is the outer context (as in a real run).
    expect(out.operations.map((o) => o.name)).toEqual(["outer"]);
    const outer = out.operations[0];
    expect(outer.error?.name).toBe("ChildContextError");
    expect(outer.error?.message).toBe(`${"x".repeat(8192)}…`);

    // With every operation in the record, the failing step is kept too.
    const tree = await failedRecord({
      executionError: contextError(),
      operations: rec2Ops(),
      operationDetail: "full-tree",
    });
    const treeOut = truncateRecord(
      tree,
      exporter.maxRecordSizeBytes,
      exporter.render,
    );
    expect(
      Buffer.byteLength(JSON.stringify(exporter.render(treeOut))),
    ).toBeLessThanOrEqual(256_000);
    expect(treeOut).toBe(tree);
    expect(treeOut.droppedOperations).toBeUndefined();
    const pay = treeOut.operations.find((o) => o.name === "pay");
    expect(pay?.error?.name).toBe("StepError");
    expect(pay?.error?.message).toBe(`${"x".repeat(8192)}…`);
  });

  it("fits a 17-level chain of 50 KB messages under 256,000 bytes with droppedCauses", async () => {
    const msg = "z".repeat(50_000);
    let cause: Error | undefined;
    for (let i = 17; i >= 1; i--) cause = named(`Cause${i}`, msg, cause);
    const error = named("TopError", msg, cause);
    const rec = await failedRecord({
      executionError: error,
      operations: {
        o1: op({
          id: "o1",
          name: "charge",
          status: "FAILED",
          startTimestamp: new Date("2026-01-01T00:00:00.000Z"),
          error,
        }),
      },
    });
    expect(depth(rec.error)).toBe(16);

    const exporter = new LambdaLogExporter();
    const out = truncateRecord(
      rec,
      exporter.maxRecordSizeBytes,
      exporter.render,
    );
    const bytes = Buffer.byteLength(JSON.stringify(exporter.render(out)));
    expect(bytes).toBeLessThanOrEqual(256_000);
    expect(out.truncated).toBe(true);
    expect(out.droppedCauses).toBe(true);
    expect(out.droppedOperations).toBeUndefined();
    expect(out.error).toEqual({
      name: "TopError",
      message: `${"z".repeat(8192)}…`,
    });
    expect(out.operations[0].error?.cause).toBeUndefined();
  });
});
