import {
  DurableOperationError,
  StepError,
  type InvocationEndInfo,
  type InvocationInfo,
  type OperationInfo,
} from "@aws/durable-execution-sdk-js";
import { runInNewContext } from "node:vm";
import { durableExecutionTelemetry, LambdaLogExporter } from "./index";
import { withOperationsByName } from "./operations-index";
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
}): Promise<DurableExecutionTelemetryRecord> {
  const exporter = new CapturingExporter();
  const factory = durableExecutionTelemetry({
    exporters: [exporter],
    emitMode: "on-complete",
    content: args.content,
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

  it("truncation drops an operation's cause together with its operation", async () => {
    const rec = await failedRecord({
      executionError: named("StepError", "failed", named("Inner", "kept")),
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
    expect(cut.droppedOperations).toBe(1);
    expect(JSON.stringify(cut)).not.toContain("Big");
    // The execution error, cause included, is never cut.
    expect(cut.error).toEqual(rec.error);
  });
});
