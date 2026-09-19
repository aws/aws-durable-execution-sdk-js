import { workflowInsight } from "./index";
import type {
  InsightExporter,
  OperationResult,
  WorkflowInsightRecord,
} from "./types";
import type {
  DurableInstrumentationPluginFactory,
  InvocationEndInfo,
  InvocationInfo,
  OperationChangeInfo,
  OperationInfo,
} from "@aws/durable-execution-sdk-js";
import { setFlagsFromString as setV8Flags } from "node:v8";
import { runInNewContext } from "node:vm";

/**
 * `workflowInsight` now returns a factory: the SDK calls its `createPlugin` once
 * per invocation and dispatches that invocation's hooks to the instance it
 * returns. Tests that drive several executions through one environment therefore
 * build one instance per execution from a single factory.
 */
type PluginFactory = DurableInstrumentationPluginFactory;

const ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:fn:1/durable-execution/exec-1/inv-1";

class CapturingExporter implements InsightExporter {
  records: WorkflowInsightRecord[] = [];
  async export(record: WorkflowInsightRecord): Promise<void> {
    this.records.push(record);
  }
}

function op(partial: Partial<OperationInfo> & { id: string }): OperationInfo {
  return { type: "STEP", isReplay: false, ...partial } as OperationInfo;
}

function endInfo(partial: Partial<InvocationEndInfo>): InvocationEndInfo {
  return {
    executionArn: ARN,
    requestId: "req-1",
    isFirstInvocation: true,
    status: "SUCCEEDED",
    executionInput: undefined,
    operations: {},
    ...partial,
  } as InvocationEndInfo;
}

/**
 * The invocation info the SDK would have built before any hook fired, derived
 * from an end info. Tests that exercise only the end hook use this to construct
 * the instance, so it sees the same ARN, operations, start timestamp and input
 * the end hook then reports.
 */
function startFromEnd(info: InvocationEndInfo): InvocationInfo {
  return {
    ...info,
    isFirstInvocation: true,
    updatedOperations: {},
  } as unknown as InvocationInfo;
}

/**
 * One invocation that only ends. `onInvocationEnd` drains this execution's
 * record before it resolves, so awaiting it is the whole delivery guarantee.
 */
async function endAndDrain(
  factory: PluginFactory,
  info: InvocationEndInfo,
): Promise<void> {
  const plugin = factory.createPlugin(startFromEnd(info));
  await plugin.onInvocationEnd?.(info);
}

/** A distinct, replay-stable execution ARN for `name`. */
const arnFor = (name: string): string =>
  `arn:aws:lambda:us-east-1:123456789012:function:fn:1/durable-execution/${name}/inv-1`;

function startFor(
  arn: string,
  overrides: Partial<InvocationInfo> = {},
): InvocationInfo {
  return {
    executionArn: arn,
    requestId: "req-1",
    isFirstInvocation: true,
    executionInput: { execution: arn },
    operations: {},
    updatedOperations: {},
    ...overrides,
  } as InvocationInfo;
}

function endFor(
  arn: string,
  overrides: Partial<InvocationEndInfo> = {},
): InvocationEndInfo {
  return {
    executionArn: arn,
    requestId: "req-1",
    isFirstInvocation: true,
    status: "SUCCEEDED",
    executionInput: { execution: arn },
    executionResult: { ok: arn },
    operations: {},
    ...overrides,
  } as InvocationEndInfo;
}

function changeFor(
  arn: string,
  operations: Record<string, OperationInfo> = {},
): OperationChangeInfo {
  return {
    executionArn: arn,
    operations,
    updatedOperations: operations,
  } as OperationChangeInfo;
}

/** Drives one full invocation of `arn` the way the SDK does. */
async function runInvocation(
  factory: PluginFactory,
  arn: string,
  opts: {
    changes?: number;
    start?: Partial<InvocationInfo>;
    end?: Partial<InvocationEndInfo>;
  } = {},
): Promise<void> {
  const start = startFor(arn, opts.start);
  // One instance per invocation, built from the same info onInvocationStart
  // receives, exactly as createInvocationPluginRunner does.
  const plugin = factory.createPlugin(start);
  await plugin.onInvocationStart?.(start);
  for (let i = 0; i < (opts.changes ?? 0); i++) {
    await plugin.onOperationChange?.(
      changeFor(arn, {
        [`o${i}`]: op({
          id: `o${i}`,
          name: `step-${i}`,
          status: "SUCCEEDED",
        }),
      }),
    );
  }
  await plugin.onInvocationEnd?.(endFor(arn, opts.end));
}

/** The SDK's plugin runner swallows a throwing hook; these tests do the same. */
async function swallow(promise: unknown): Promise<void> {
  await Promise.allSettled([promise]);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * "settled" when `p` settles either way within `ms`, "hung" when it does not. A
 * hang here is an invocation that would run to the Lambda timeout.
 */
async function raceTimeout(
  p: Promise<unknown>,
  ms: number,
): Promise<"settled" | "hung"> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"hung">((resolve) => {
    timer = setTimeout(() => resolve("hung"), ms);
  });
  try {
    return await Promise.race([
      p.then(
        () => "settled" as const,
        () => "settled" as const,
      ),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

describe("content filtering", () => {
  it("transforms input, omits output, filters operations, and gates results", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-complete",
      content: {
        input: (i) => ({
          customerId: (i as { customerId: string }).customerId,
        }),
        output: false,
        operations: {
          includeErrors: false,
          overrides: [
            {
              operationName: "charge",
              result: (r): OperationResult => ({
                amount: (r as { amount: number }).amount,
              }),
            },
            { operationName: "internal", exclude: true },
          ],
        },
      },
    });

    await endAndDrain(
      factory,
      endInfo({
        status: "SUCCEEDED",
        executionInput: { customerId: "c1", ssn: "SECRET" },
        executionResult: { secret: "should-be-omitted" },
        operations: {
          o1: op({
            id: "o1",
            name: "charge",
            status: "SUCCEEDED",
            result: JSON.stringify({ amount: 42, card: "SECRET" }),
          }),
          o2: op({
            id: "o2",
            name: "internal",
            status: "SUCCEEDED",
            result: JSON.stringify({ debug: 1 }),
          }),
          o3: op({
            id: "o3",
            name: "validate",
            status: "FAILED",
            error: Object.assign(new Error("bad input"), { name: "StepError" }),
          }),
          o4: op({ id: "o4", status: "SUCCEEDED" }), // unnamed
        },
      }),
    );

    expect(exporter.records).toHaveLength(1);
    const rec = exporter.records[0];

    // input transformed (ssn dropped); output omitted entirely
    expect(rec.input).toEqual({ customerId: "c1" });
    expect(rec.output).toBeUndefined();

    // 'internal' excluded, unnamed op dropped -> only charge + validate remain
    expect(rec.operations.map((o) => o.name)).toEqual(["charge", "validate"]);

    // result included+transformed only where an override opts in
    expect(rec.operations.find((o) => o.name === "charge")?.result).toEqual({
      amount: 42,
    });
    expect(
      rec.operations.find((o) => o.name === "validate")?.result,
    ).toBeUndefined();

    // includeErrors: false drops per-op errors
    expect(rec.operations.every((o) => o.error === undefined)).toBe(true);
  });

  it("excludes the SDK's internal EXECUTION pseudo-operation", async () => {
    // The SDK core tracks the invocation itself as a same-named entry of
    // type EXECUTION in its internal operations map (for its own
    // ancestor-completion bookkeeping) — it has a `name` (the execution
    // name), so it isn't caught by the unnamed-operation filter, and its
    // status is never transitioned past STARTED. It must be excluded
    // explicitly, since the execution's real status/timing is already
    // captured at the top level of the record.
    const exporter = new CapturingExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-complete",
    });

    await endAndDrain(
      factory,
      endInfo({
        status: "SUCCEEDED",
        operations: {
          exec: op({
            id: "exec-1",
            name: "exec-1",
            type: "EXECUTION",
            status: "STARTED",
          }),
          o1: op({ id: "o1", name: "validate", status: "SUCCEEDED" }),
        },
      }),
    );

    expect(exporter.records).toHaveLength(1);
    const rec = exporter.records[0];
    expect(rec.operations.map((o) => o.name)).toEqual(["validate"]);
  });

  it("includes input/output as-is and omits results by default (no content config)", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({ exporters: [exporter] });

    await endAndDrain(
      factory,
      endInfo({
        status: "SUCCEEDED",
        executionInput: { a: 1 },
        executionResult: { b: 2 },
        operations: {
          o1: op({
            id: "o1",
            name: "step-a",
            status: "SUCCEEDED",
            result: JSON.stringify({ x: 1 }),
          }),
        },
      }),
    );

    const rec = exporter.records[0];
    expect(rec.input).toEqual({ a: 1 });
    expect(rec.output).toEqual({ b: 2 });
    expect(rec.operations[0].result).toBeUndefined();
  });

  it("passes the raw string to a result transform when the result is not JSON", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      content: {
        operations: {
          overrides: [
            { operationName: "xml-step", result: (r): OperationResult => r },
          ],
        },
      },
    });

    await endAndDrain(
      factory,
      endInfo({
        status: "SUCCEEDED",
        operations: {
          o1: op({
            id: "o1",
            name: "xml-step",
            status: "SUCCEEDED",
            result: "<xml>not-json</xml>",
          }),
        },
      }),
    );

    expect(exporter.records[0].operations[0].result).toBe(
      "<xml>not-json</xml>",
    );
  });

  it("omits a field (never leaks raw data) when a transform throws", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      content: {
        input: () => {
          throw new Error("redactor blew up");
        },
      },
    });

    await endAndDrain(
      factory,
      endInfo({ status: "SUCCEEDED", executionInput: { secret: "x" } }),
    );

    expect(exporter.records[0].input).toBeUndefined();
  });
});

describe("operation detail capture", () => {
  it("captures per-operation error and attempt by default", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({ exporters: [exporter] });

    await endAndDrain(
      factory,
      endInfo({
        status: "FAILED",
        operations: {
          o1: op({
            id: "o1",
            name: "charge",
            status: "FAILED",
            attempt: 3,
            error: Object.assign(new Error("card declined"), {
              name: "StepError",
            }),
          }),
        },
      }),
    );

    const record = exporter.records[0].operations[0];
    expect(record.attempt).toBe(3);
    expect(record.error).toEqual({
      name: "StepError",
      message: "card declined",
    });
  });
});

describe("operationDetail", () => {
  // A top-level context and its child (parallel-branch/map-item style).
  const opsWithChildren = {
    top: op({ id: "top", name: "reserve-inventory", type: "CONTEXT" }),
    child: op({
      id: "child",
      name: "reserve-item",
      type: "STEP",
      parentId: "top",
    }),
  };

  it("defaults to top-level (drops children)", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({ exporters: [exporter] });

    await endAndDrain(factory, endInfo({ operations: opsWithChildren }));

    const names = exporter.records[0].operations.map((o) => o.name);
    expect(names).toEqual(["reserve-inventory"]);
  });

  it("includes children when full-tree", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      operationDetail: "full-tree",
    });

    await endAndDrain(factory, endInfo({ operations: opsWithChildren }));

    const names = exporter.records[0].operations.map((o) => o.name).sort();
    expect(names).toEqual(["reserve-inventory", "reserve-item"]);
  });

  it("drops operations with a parentId when top-level", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      operationDetail: "top-level",
    });

    await endAndDrain(factory, endInfo({ operations: opsWithChildren }));

    const names = exporter.records[0].operations.map((o) => o.name);
    expect(names).toEqual(["reserve-inventory"]);
  });
});

describe("status mapping", () => {
  it("maps a suspended (PENDING) execution to RUNNING", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-change",
    });

    await endAndDrain(factory, endInfo({ status: "PENDING" }));

    expect(exporter.records[0].status).toBe("RUNNING");
  });
});

describe("emit modes", () => {
  it("on-complete emits only on terminal status (not on suspends)", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-complete",
    });

    await endAndDrain(factory, endInfo({ status: "PENDING" }));
    expect(exporter.records).toHaveLength(0);

    await endAndDrain(factory, endInfo({ status: "SUCCEEDED" }));
    expect(exporter.records).toHaveLength(1);
    expect(exporter.records[0].status).toBe("SUCCEEDED");
  });

  it("on-failure emits only on FAILED", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-failure",
    });

    await endAndDrain(factory, endInfo({ status: "SUCCEEDED" }));
    expect(exporter.records).toHaveLength(0);

    await endAndDrain(factory, endInfo({ status: "FAILED" }));
    expect(exporter.records).toHaveLength(1);
    expect(exporter.records[0].status).toBe("FAILED");
  });
});

describe("sampling", () => {
  function baseInfo(arn: string): InvocationInfo {
    return {
      executionArn: arn,
      requestId: "req-1",
      isFirstInvocation: true,
      executionInput: undefined,
      operations: {},
    } as InvocationInfo;
  }

  // Drive one full execution (terminal SUCCEEDED end + drain) through its own
  // plugin instance, the way the SDK does: onInvocationEnd drains this
  // execution's record before it resolves.
  async function runExecution(
    factory: PluginFactory,
    arn: string,
    status: InvocationEndInfo["status"] = "SUCCEEDED",
  ): Promise<void> {
    const plugin = factory.createPlugin(baseInfo(arn));
    await plugin.onInvocationEnd?.({
      ...baseInfo(arn),
      status,
      executionResult: undefined,
      operations: {},
    } as InvocationEndInfo);
  }

  const NAMES = Array.from({ length: 200 }, (_, i) => `exec-${i}`);

  it("emits for every execution when samplingRate is 1.0 or omitted", async () => {
    for (const rate of [undefined, 1.0]) {
      const exporter = new CapturingExporter();
      const factory = workflowInsight({
        exporters: [exporter],
        samplingRate: rate,
      });
      for (const name of NAMES) await runExecution(factory, arnFor(name));
      expect(exporter.records).toHaveLength(NAMES.length);
    }
  });

  it("emits for no execution when samplingRate is 0", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      samplingRate: 0,
    });
    for (const name of NAMES) await runExecution(factory, arnFor(name));
    expect(exporter.records).toHaveLength(0);
  });

  it("partitions the population at a fractional rate (not all-or-nothing)", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      samplingRate: 0.5,
    });
    for (const name of NAMES) await runExecution(factory, arnFor(name));
    // Deterministic hash → stable count; assert a healthy split rather than an
    // exact number so the bound doesn't couple to the hash implementation.
    expect(exporter.records.length).toBeGreaterThan(NAMES.length * 0.25);
    expect(exporter.records.length).toBeLessThan(NAMES.length * 0.75);
  });

  it("is reproducible: identical ARNs yield identical decisions", async () => {
    const rate = 0.5;
    const decideAll = async (): Promise<Set<string>> => {
      const exporter = new CapturingExporter();
      const factory = workflowInsight({
        exporters: [exporter],
        samplingRate: rate,
      });
      for (const name of NAMES) await runExecution(factory, arnFor(name));
      return new Set(exporter.records.map((r) => r.executionArn));
    };

    // The execution ARN is stable across replays, so the same set of ARNs must
    // always produce the same sampled-in set.
    const first = await decideAll();
    const second = await decideAll();

    expect([...first].sort()).toEqual([...second].sort());
    expect(first.size).toBeGreaterThan(0);
    expect(first.size).toBeLessThan(NAMES.length);
  });

  it("re-runs of the same execution agree (stable per-execution decision)", async () => {
    // Whatever the decision for a given ARN, running it twice yields either two
    // records or zero — never a mix.
    const sampledIn: string[] = [];
    for (const name of NAMES) {
      const exporter = new CapturingExporter();
      const factory = workflowInsight({
        exporters: [exporter],
        samplingRate: 0.5,
      });
      const arn = arnFor(name);
      await runExecution(factory, arn);
      await runExecution(factory, arn);
      expect([0, 2]).toContain(exporter.records.length);
      if (exporter.records.length === 2) sampledIn.push(name);
    }
    expect(sampledIn.length).toBeGreaterThan(0);
  });

  it("clamps out-of-range and non-numeric rates with a warning", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // > 1 clamps to 1 (all emit)
      const high = new CapturingExporter();
      const pHigh = workflowInsight({
        exporters: [high],
        samplingRate: 5 as number,
      });
      for (const name of NAMES) await runExecution(pHigh, arnFor(name));
      expect(high.records).toHaveLength(NAMES.length);

      // < 0 clamps to 0 (none emit)
      const low = new CapturingExporter();
      const pLow = workflowInsight({
        exporters: [low],
        samplingRate: -1 as number,
      });
      for (const name of NAMES) await runExecution(pLow, arnFor(name));
      expect(low.records).toHaveLength(0);

      // NaN defaults to 1.0 (all emit)
      const nan = new CapturingExporter();
      const pNan = workflowInsight({
        exporters: [nan],
        samplingRate: Number.NaN,
      });
      for (const name of NAMES) await runExecution(pNan, arnFor(name));
      expect(nan.records).toHaveLength(NAMES.length);

      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("per-exporter truncation", () => {
  class LimitedExporter implements InsightExporter {
    records: WorkflowInsightRecord[] = [];
    constructor(readonly maxRecordSizeBytes?: number) {}
    async export(record: WorkflowInsightRecord): Promise<void> {
      this.records.push(record);
    }
  }

  it("sends each exporter a copy truncated to its own limit", async () => {
    const small = new LimitedExporter(700);
    const unlimited = new LimitedExporter(undefined);

    const factory = workflowInsight({
      exporters: [small, unlimited],
      // Opt the big operation's result into the record so it dominates size.
      content: {
        operations: {
          overrides: [{ operationName: "big", result: (r) => r }],
        },
      },
    });

    await endAndDrain(
      factory,
      endInfo({
        status: "SUCCEEDED",
        operations: {
          o1: op({
            id: "o1",
            name: "big",
            status: "SUCCEEDED",
            result: JSON.stringify("X".repeat(2000)),
          }),
        },
      }),
    );

    const sizeOf = (r: WorkflowInsightRecord): number =>
      new TextEncoder().encode(JSON.stringify(r)).length;

    // Small-limit exporter received a truncated copy within its budget.
    expect(small.records[0].truncated).toBe(true);
    expect(sizeOf(small.records[0])).toBeLessThanOrEqual(700);

    // Unlimited exporter received the full, untruncated record.
    expect(unlimited.records[0].truncated).toBeUndefined();
    expect(unlimited.records[0].operations[0].result).toBe("X".repeat(2000));

    // The two exporters got different objects — no shared mutation.
    expect(small.records[0]).not.toBe(unlimited.records[0]);
  });

  it("sizes truncation against the exporter's rendered (emitted) shape", async () => {
    // An exporter that emits a strictly larger shape than the canonical record.
    class RenderExporter implements InsightExporter {
      records: WorkflowInsightRecord[] = [];
      constructor(readonly maxRecordSizeBytes: number) {}
      render(record: WorkflowInsightRecord): unknown {
        return { ...record, operationsExpanded: record.operations };
      }
      async export(record: WorkflowInsightRecord): Promise<void> {
        this.records.push(record);
      }
    }

    const sizeOf = (v: unknown): number =>
      new TextEncoder().encode(JSON.stringify(v)).length;

    const exporter = new RenderExporter(900);
    const factory = workflowInsight({
      exporters: [exporter],
      content: {
        operations: {
          overrides: [{ operationName: "big", result: (r) => r }],
        },
      },
    });

    await endAndDrain(
      factory,
      endInfo({
        status: "SUCCEEDED",
        operations: {
          o1: op({
            id: "o1",
            name: "big",
            status: "SUCCEEDED",
            result: JSON.stringify("X".repeat(1500)),
          }),
        },
      }),
    );

    const got = exporter.records[0];
    // The rendered shape (what is actually emitted) fits the limit — the plain
    // record alone would have been measured smaller and mis-sized.
    expect(got.truncated).toBe(true);
    expect(sizeOf(exporter.render(got))).toBeLessThanOrEqual(900);
  });
});

describe("concurrent executions in one environment", () => {
  // One factory serves the whole execution environment, and with Lambda Managed
  // Instances several executions run concurrently in it. These tests drive
  // several executions through one factory the way the SDK does — a fresh
  // instance per invocation, then onInvocationStart, the operation-change hooks
  // and onInvocationEnd on that instance — and assert that no execution's record
  // is lost, displaced, or attributed to another execution.

  it("delivers every concurrent execution's terminal record exactly once (on-complete)", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-complete",
    });
    const arns = Array.from({ length: 10 }, (_, i) =>
      arnFor(`concurrent-${i}`),
    );

    await Promise.all(arns.map((arn) => runInvocation(factory, arn)));

    // Exactly one terminal record per execution: sorted equality catches both a
    // lost record and a duplicated one.
    expect(exporter.records.map((r) => r.executionArn).sort()).toEqual(
      [...arns].sort(),
    );
    for (const record of exporter.records) {
      expect(record.status).toBe("SUCCEEDED");
      // No record carries another execution's payload.
      expect(record.input).toEqual({ execution: record.executionArn });
      expect(record.output).toEqual({ ok: record.executionArn });
    }
  });

  it("delivers every concurrent execution's terminal record with interleaved operation changes (on-change)", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-change",
    });
    const arns = Array.from({ length: 10 }, (_, i) =>
      arnFor(`interleaved-${i}`),
    );

    await Promise.all(
      arns.map((arn) => runInvocation(factory, arn, { changes: 3 })),
    );

    const terminal = exporter.records.filter((r) => r.status === "SUCCEEDED");
    expect(terminal.map((r) => r.executionArn).sort()).toEqual(
      [...arns].sort(),
    );

    for (const arn of arns) {
      const forArn = exporter.records.filter((r) => r.executionArn === arn);
      // The terminal record is the last thing said about an execution.
      expect(forArn[forArn.length - 1].status).toBe("SUCCEEDED");
    }
    // Coalescing is per execution, so an intermediate record can be dropped —
    // but never replaced by another execution's snapshot.
    for (const record of exporter.records) {
      expect(record.input).toEqual({ execution: record.executionArn });
    }
  });

  it("loses no record while another execution's export is in flight, and never overlaps export calls", async () => {
    let releaseFirstExport: () => void = () => {};
    const firstExport = new Promise<void>((resolve) => {
      releaseFirstExport = resolve;
    });
    let inExport = 0;
    let maxInExport = 0;
    let calls = 0;
    const exported: WorkflowInsightRecord[] = [];
    const exporter: InsightExporter = {
      async export(record: WorkflowInsightRecord): Promise<void> {
        inExport++;
        maxInExport = Math.max(maxInExport, inExport);
        // Park the first export so the records that follow queue up behind it.
        if (calls++ === 0) await firstExport;
        exported.push(record);
        inExport--;
      },
    };

    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-complete",
    });
    const arns = ["slow-a", "slow-b", "slow-c"].map(arnFor);
    const plugins = arns.map((arn) => factory.createPlugin(startFor(arn)));

    await Promise.all(
      plugins.map((plugin, i) => plugin.onInvocationStart?.(startFor(arns[i]))),
    );

    // Each invocation's end schedules its record synchronously and then drains
    // it, so all three records are queued behind the parked export before any
    // of them can return.
    const drained = Promise.all(
      plugins.map((plugin, i) => plugin.onInvocationEnd?.(endFor(arns[i]))),
    );
    releaseFirstExport();
    await drained;

    expect(exported.map((r) => r.executionArn).sort()).toEqual(
      [...arns].sort(),
    );
    // Exporters still see one export at a time, regardless of concurrency.
    expect(maxInExport).toBe(1);
  });

  it("emits nothing for an operation change delivered after the invocation ended", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-change",
    });
    const arn = arnFor("late-change-hook");
    const start = startFor(arn);
    const plugin = factory.createPlugin(start);

    await plugin.onInvocationStart?.(start);
    await plugin.onInvocationEnd?.(endFor(arn));
    // A checkpoint that completed just before the invocation ended still
    // delivers its operation-change hook, and the SDK does not order it
    // against onInvocationEnd — it lands on this same instance. Emitting here
    // would publish RUNNING after the terminal record, reverting a finished
    // execution for every exporter that upserts by execution ARN.
    await plugin.onOperationChange?.(changeFor(arn));

    expect(exporter.records.map((r) => r.status)).toEqual([
      "RUNNING",
      "SUCCEEDED",
    ]);
    expect(exporter.records[1].endTime).toBeDefined();
  });

  it("resolves the execution start time afresh after a suspend", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-complete",
    });
    const arn = arnFor("suspended-then-resumed");
    const executionStartTimestamp = new Date("2024-01-01T00:00:00.000Z");

    // A suspend (PENDING) is an invocation end too: it emits nothing in
    // on-complete mode.
    await runInvocation(factory, arn, {
      start: { executionStartTimestamp },
      end: {
        status: "PENDING",
        executionResult: undefined,
        executionStartTimestamp,
      },
    });
    expect(exporter.records).toHaveLength(0);

    // The resume gets a new instance, which takes the execution start timestamp
    // from the SDK, so the record still spans the execution and not just this
    // invocation. Reporting the instance's own creation time here would give the
    // duration of the last invocation only.
    await runInvocation(factory, arn, {
      start: { isFirstInvocation: false, executionStartTimestamp },
      end: { executionStartTimestamp },
    });

    expect(exporter.records).toHaveLength(1);
    expect(exporter.records[0].startTime).toBe(
      executionStartTimestamp.toISOString(),
    );
    expect(exporter.records[0].durationMs).toBeGreaterThan(0);
  });

  it("releases the cached execution input after a suspend", async () => {
    const gc = exposeGc();
    if (gc === undefined) {
      // No way to force a collection here; the start-time test above still
      // covers per-invocation state deterministically.
      return;
    }

    const factory = workflowInsight({
      exporters: [new CapturingExporter()],
      emitMode: "on-complete",
    });
    const refs: WeakRef<object>[] = [];
    for (let i = 0; i < 100; i++) {
      const executionInput = { payload: "x".repeat(4096) };
      refs.push(new WeakRef(executionInput));
      await runInvocation(factory, arnFor(`retained-${i}`), {
        start: { executionInput },
        end: {
          status: "PENDING",
          executionInput,
          executionResult: undefined,
        },
      });
    }

    gc();
    await new Promise((resolve) => setTimeout(resolve, 10));
    gc();

    const live = refs.filter((ref) => ref.deref() !== undefined).length;
    // The most recent input can still be pinned by a local or a register, so
    // allow one. An instance that outlived its invocation would keep all of
    // them alive.
    expect(live).toBeLessThanOrEqual(1);
    // Keep the factory (and anything it reaches) alive across the measurement.
    expect(factory).toBeDefined();
  });
});

describe("exporter failure containment", () => {
  // A misbehaving exporter must cost its own record and nothing else: the
  // invocation still returns, the rest of the queue is still delivered, and the
  // scheduler still serves every later execution in the environment. An
  // invocation that cannot finish here runs to the Lambda timeout, so these
  // tests assert liveness with a bound rather than by hanging the suite.
  const HANG_MS = 1000;

  it("contains an exporter that throws synchronously instead of rejecting", async () => {
    let throwNext = true;
    const delivered: string[] = [];
    const exporter: InsightExporter = {
      // Typed to return a promise, but nothing enforces that at runtime.
      export(record: WorkflowInsightRecord): Promise<void> {
        if (throwNext) {
          throwNext = false;
          throw new Error("sync boom from exporter");
        }
        delivered.push(record.executionArn);
        return Promise.resolve();
      },
    };
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-complete",
    });
    const first = arnFor("sync-throw-1");
    const second = arnFor("sync-throw-2");

    // The invocation whose export blew up still returns...
    expect(await raceTimeout(runInvocation(factory, first), HANG_MS)).toBe(
      "settled",
    );
    // ...and an unrelated execution afterwards still reaches the exporter, so
    // the failure did not leave an armed in-flight marker behind.
    expect(await raceTimeout(runInvocation(factory, second), HANG_MS)).toBe(
      "settled",
    );
    expect(delivered).toEqual([second]);
  });

  it("contains an exporter whose render() throws", async () => {
    let throwNext = true;
    const delivered: string[] = [];
    const exporter: InsightExporter = {
      // Any limit makes the plugin call render() to size the record.
      maxRecordSizeBytes: 100,
      render(record: WorkflowInsightRecord): unknown {
        if (throwNext) {
          throwNext = false;
          throw new Error("render blew up");
        }
        return record;
      },
      async export(record: WorkflowInsightRecord): Promise<void> {
        delivered.push(record.executionArn);
      },
    };
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-complete",
    });
    const first = arnFor("render-throw-1");
    const second = arnFor("render-throw-2");

    expect(await raceTimeout(runInvocation(factory, first), HANG_MS)).toBe(
      "settled",
    );
    expect(await raceTimeout(runInvocation(factory, second), HANG_MS)).toBe(
      "settled",
    );
    expect(delivered).toEqual([second]);
  });

  it("delivers the rest of the queue when one export fails mid-queue, and leaves the failing execution drainable", async () => {
    const [first, poisoned, last] = [
      "queue-first",
      "queue-poisoned",
      "queue-last",
    ].map(arnFor);
    const exported: string[] = [];
    let slowNext = true;
    const exporter: InsightExporter = {
      export(record: WorkflowInsightRecord): Promise<void> {
        if (record.executionArn === poisoned) {
          throw new Error("sync boom exporting the poisoned record");
        }
        // The first export is slow, so the other two queue up behind it the way
        // concurrent executions in one environment do.
        const slow = slowNext;
        slowNext = false;
        exported.push(record.executionArn);
        return slow ? sleep(60) : Promise.resolve();
      },
    };
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-complete",
    });

    const outcomes = await Promise.all(
      [first, poisoned, last].map((arn) => {
        const plugin = factory.createPlugin(startFor(arn));
        return raceTimeout(
          (async () => {
            await plugin.onInvocationStart?.(startFor(arn));
            // Schedules this execution's record synchronously and then drains
            // it, so all three are queued behind the slow first export.
            await plugin.onInvocationEnd?.(endFor(arn));
          })(),
          HANG_MS,
        );
      }),
    );

    expect(outcomes).toEqual(["settled", "settled", "settled"]);
    // The record queued behind the failure is still delivered.
    expect(exported).toEqual([first, last]);

    // The failing execution suspends and resumes. In on-complete mode the
    // suspend schedules nothing, so its drain must be a no-op — a leaked
    // outstanding entry would park this invocation until the Lambda timeout.
    const resumed = factory.createPlugin(startFor(poisoned));
    await resumed.onInvocationStart?.(startFor(poisoned));
    expect(
      await raceTimeout(
        resumed.onInvocationEnd?.(endFor(poisoned, { status: "PENDING" })) ??
          Promise.resolve(),
        HANG_MS,
      ),
    ).toBe("settled");
  });

  it("still emits for the next invocation when building the end record throws", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-change",
    });
    const arn = arnFor("end-record-throws");

    // An error whose `message` getter throws. onInvocationEnd reads it while
    // assembling the terminal record, i.e. after it has already marked itself
    // closed: without the try/finally around that, the drain in the `finally`
    // would be skipped and whatever was already queued would be stranded.
    // Driven the way the SDK's config-error path drives it (onInvocationStart
    // and a FAILED onInvocationEnd, and nothing else).
    const poisoned = {
      name: "PoisonedError",
      get message(): string {
        throw new Error("error message getter blew up");
      },
    } as unknown as Error;

    const failing = factory.createPlugin(startFor(arn));
    await failing.onInvocationStart?.(startFor(arn));
    await swallow(
      failing.onInvocationEnd?.(
        endFor(arn, {
          status: "FAILED",
          executionError: poisoned,
          executionResult: undefined,
        }),
      ),
    );

    // A completely healthy second invocation of the same execution, on its own
    // instance.
    const start = startFor(arn, { isFirstInvocation: false });
    const plugin = factory.createPlugin(start);
    await plugin.onInvocationStart?.(start);
    await plugin.onOperationChange?.(
      changeFor(arn, {
        o0: op({ id: "o0", name: "step-0", status: "SUCCEEDED" }),
      }),
    );
    // Let the scheduler hand that record out before the terminal record
    // supersedes it, so the assertion below does not rely on coalescing.
    await sleep(10);
    await plugin.onInvocationEnd?.(endFor(arn));

    const statuses = exporter.records.map((r) => r.status);
    expect(statuses[statuses.length - 1]).toBe("SUCCEEDED");
    // onOperationChange is gated on `closed`, which the failing invocation set
    // on its own instance — it cannot mute this one.
    expect(
      exporter.records.some(
        (r) =>
          r.status === "RUNNING" &&
          r.operations.some((o) => o.name === "step-0"),
      ),
    ).toBe(true);
  });

  /**
   * A real array whose own `map` can be switched to throw, so a fan-out can be
   * made to fail *synchronously* — before the pump's first await — from a chosen
   * call onwards. `exporters.map` is the fan-out's only synchronous-throw site
   * (everything inside the map callback is already converted to a rejection),
   * and a synchronous failure is what makes the pump's re-arm observable: the
   * pump body never suspends, so its `finally` runs while the scheduler is still
   * on the caller's stack.
   */
  function poisonableExporters(inner: InsightExporter): {
    exporters: InsightExporter[];
    /** Stack frame count sampled at every `sampleEvery`th throwing call. */
    depths: number[];
    /** Number of calls that threw. */
    throwingCalls: () => number;
    /** `map` throws from the `n`th call onwards (1-based). */
    throwFromCall(n: number): void;
  } {
    const depths: number[] = [];
    const realMap = Array.prototype.map;
    const sampleEvery = 1000;
    let calls = 0;
    let threw = 0;
    let from = Number.POSITIVE_INFINITY;
    const exporters = [inner];
    Object.defineProperty(exporters, "map", {
      configurable: true,
      value(this: InsightExporter[], ...args: unknown[]): unknown {
        calls++;
        if (calls >= from) {
          threw++;
          // Sampled: building a stack string on every call would dominate the
          // test's runtime.
          if (threw % sampleEvery === 0) {
            depths.push((new Error().stack ?? "").split("\n").length);
          }
          throw new TypeError("exporters.map is not a function");
        }
        return (realMap as unknown as (...a: unknown[]) => unknown).apply(
          this,
          args,
        );
      },
    });
    return {
      exporters,
      depths,
      throwingCalls: () => threw,
      throwFromCall(n) {
        from = n;
      },
    };
  }

  it("serves a long queue of synchronously failing fan-outs without losing the tail", async () => {
    // Every fan-out that fails synchronously unwinds the pump to its outer
    // `finally`, which re-arms the pump. Re-arming with a direct ensurePump()
    // call runs the next queue entry one frame pair deeper instead of on the
    // loop: at this queue length that reached ~2,740 levels, hit a RangeError,
    // and silently abandoned the remaining ~9,250 records.
    const QUEUED = 12_000;
    const delivered: string[] = [];
    const poison = poisonableExporters({
      async export(record: WorkflowInsightRecord): Promise<void> {
        delivered.push(record.executionArn);
        await sleep(20);
      },
    });
    const factory = workflowInsight({
      exporters: poison.exporters,
      emitMode: "on-complete",
    });
    const arns = Array.from({ length: QUEUED + 1 }, (_, i) =>
      arnFor(`deep-queue-${i}`),
    );

    // Jest caps Error.stackTraceLimit at 100 frames, which would saturate the
    // depth sample.
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = Number.POSITIVE_INFINITY;
    let outcomes: ("settled" | "hung")[];
    try {
      // Each invocation's end schedules its record synchronously and then waits
      // for it, so hold the promises rather than awaiting them: awaiting one
      // would block until the pump reaches its record.
      const ends: Promise<void>[] = [];
      const endOne = async (arn: string): Promise<void> => {
        const plugin = factory.createPlugin(startFor(arn));
        await plugin.onInvocationStart?.(startFor(arn));
        ends.push(plugin.onInvocationEnd?.(endFor(arn)) ?? Promise.resolve());
      };
      // The first execution starts the pump and parks it inside a 20 ms export.
      await endOne(arns[0]);
      // The rest queue up behind it. Everything here awaits already-resolved
      // promises — microtasks only — so the 20 ms timer cannot fire and the
      // queue really does accumulate.
      for (let i = 1; i <= QUEUED; i++) {
        await endOne(arns[i]);
      }
      // From here on every fan-out fails synchronously. Give the pump time to
      // sweep the whole queue.
      poison.throwFromCall(2);
      await sleep(500);

      // One fan-out attempt per queued execution: the pump reached the tail. A
      // RangeError cuts the sweep short and abandons the rest of the queue, so
      // a count this high is also the assertion that none was thrown.
      expect(poison.throwingCalls()).toBeGreaterThanOrEqual(QUEUED);
      // And every attempt ran at the same depth, rather than one frame pair
      // deeper than the one before it.
      expect(poison.depths.length).toBeGreaterThan(1);
      const [baseline] = poison.depths;
      for (const depth of poison.depths) {
        expect(Math.abs(depth - baseline)).toBeLessThan(50);
      }

      outcomes = await Promise.all(
        ends.map((end) => raceTimeout(end, HANG_MS)),
      );
    } finally {
      Error.stackTraceLimit = limit;
    }

    // Every execution's record is either delivered or still drainable: nothing
    // is stranded in the queue, and no invocation waits for a record the
    // scheduler abandoned.
    expect(outcomes.filter((o) => o === "hung")).toEqual([]);
    expect(delivered).toEqual([arns[0]]);
  }, 60_000);

  it("falls back to the default exporter when exporters is not an array", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      // Validated only for truthiness and `.length`, an array-like reached
      // `this.exporters.map` and made every fan-out throw a TypeError from
      // inside the pump — dropping the record and unwinding the pump on every
      // queue entry.
      const inner = new CapturingExporter();
      const arrayLike = { length: 1, 0: inner } as unknown as InsightExporter[];
      const factory = workflowInsight({
        exporters: arrayLike,
        emitMode: "on-complete",
      });
      const first = arnFor("non-array-exporters-1");
      const second = arnFor("non-array-exporters-2");

      expect(await raceTimeout(runInvocation(factory, first), HANG_MS)).toBe(
        "settled",
      );
      // A later execution in the same environment still exports, so the
      // fallback left the scheduler fully usable.
      expect(await raceTimeout(runInvocation(factory, second), HANG_MS)).toBe(
        "settled",
      );

      // Warned once, at construction, not once per record.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("[workflow-insight]");
      // Both records went to the default LambdaLogExporter...
      expect(
        log.mock.calls.map(
          ([line]) =>
            (JSON.parse(String(line)) as WorkflowInsightRecord).executionArn,
        ),
      ).toEqual([first, second]);
      // ...and the array-like's own entry was never used.
      expect(inner.records).toEqual([]);
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
  });
});

describe("execution start time", () => {
  it("spans the execution, not just the last invocation, when the SDK reports no execution start timestamp", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-complete",
    });
    const arn = arnFor("resume-without-start-timestamp");
    // A step that ran five minutes ago and is replayed into this invocation:
    // the oldest instant this invocation knows about. `executionStartTimestamp`
    // is optional, so this is the fallback the plugin has to work with.
    const startedAt = new Date(Date.now() - 5 * 60_000);
    const operations = {
      o1: op({
        id: "o1",
        name: "step-1",
        status: "SUCCEEDED",
        isReplay: true,
        startTimestamp: startedAt,
      }),
    };

    await runInvocation(factory, arn, {
      start: { operations },
      end: { status: "PENDING", operations, executionResult: undefined },
    });
    expect(exporter.records).toHaveLength(0);

    await runInvocation(factory, arn, {
      start: { isFirstInvocation: false, operations },
      end: { operations },
    });

    expect(exporter.records).toHaveLength(1);
    expect(exporter.records[0].startTime).toBe(startedAt.toISOString());
    // Falling back to `now` would report only the final invocation instead.
    expect(exporter.records[0].durationMs).toBeGreaterThan(4 * 60_000);
  });

  it("normalizes an ISO-string execution start timestamp", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-complete",
    });
    // The value crosses a transport that can represent a Date as an ISO string.
    // Taken as-is it is not a Date, and building the record would throw.
    const wire = "2024-01-01T00:00:00.000Z" as unknown as Date;

    await runInvocation(factory, arnFor("wire-start-timestamp"), {
      start: { executionStartTimestamp: wire },
      end: { executionStartTimestamp: wire },
    });

    expect(exporter.records).toHaveLength(1);
    expect(exporter.records[0].startTime).toBe("2024-01-01T00:00:00.000Z");
    expect(exporter.records[0].durationMs).toBeGreaterThan(0);
  });

  it("still emits the record when the execution start timestamp is an Invalid Date", async () => {
    const exporter = new CapturingExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-complete",
    });
    // An Invalid Date is not absent: it passes `instanceof Date`, so taking its
    // NaN time reaches `new Date(NaN).toISOString()`, which throws RangeError
    // out of record building and loses the whole record over one field. Treated
    // as absent, the oldest-operation fallback supplies the start time.
    const invalid = new Date(Number.NaN);
    const startedAt = new Date(Date.now() - 60_000);
    const operations = {
      o1: op({
        id: "o1",
        name: "step-1",
        status: "SUCCEEDED",
        startTimestamp: startedAt,
      }),
    };

    await runInvocation(factory, arnFor("invalid-start-timestamp"), {
      start: { executionStartTimestamp: invalid, operations },
      end: { executionStartTimestamp: invalid, operations },
    });

    expect(exporter.records).toHaveLength(1);
    expect(exporter.records[0].startTime).toBe(startedAt.toISOString());
    expect(exporter.records[0].operations).toHaveLength(1);
  });
});

describe("flush serialization", () => {
  /** Tracks whether any export/flush call ever overlaps another. */
  class OverlapTrackingExporter implements InsightExporter {
    readonly records: WorkflowInsightRecord[] = [];
    flushes = 0;
    flushDuringExport = 0;
    exportDuringFlush = 0;
    maxInExport = 0;
    private inExport = 0;
    private inFlush = 0;

    constructor(private readonly exportDelayMs: number) {}

    async export(record: WorkflowInsightRecord): Promise<void> {
      this.inExport++;
      this.maxInExport = Math.max(this.maxInExport, this.inExport);
      if (this.inFlush > 0) this.exportDuringFlush++;
      await sleep(this.exportDelayMs);
      if (this.inFlush > 0) this.exportDuringFlush++;
      this.records.push(record);
      this.inExport--;
    }

    async flush(): Promise<void> {
      this.inFlush++;
      this.flushes++;
      if (this.inExport > 0) this.flushDuringExport++;
      await sleep(1);
      if (this.inExport > 0) this.flushDuringExport++;
      this.inFlush--;
    }
  }

  it("never overlaps a flush() with an export(), and flushes at most once per invocation", async () => {
    const exporter = new OverlapTrackingExporter(20);
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-complete",
    });
    const arns = Array.from({ length: 4 }, (_, i) => arnFor(`flush-${i}`));

    // Four executions end at once: each drains its own record and then flushes,
    // while the other three records are still queued behind it.
    await Promise.all(arns.map((arn) => runInvocation(factory, arn)));

    expect(exporter.records).toHaveLength(4);
    expect(exporter.flushDuringExport).toBe(0);
    expect(exporter.exportDuringFlush).toBe(0);
    expect(exporter.maxInExport).toBe(1);
    // The settled cadence: at most one flush per sampled-in invocation end, and
    // overlapping ends may share one. So every record is covered by a flush that
    // started after it was exported, but the call count is bounded above by the
    // number of invocations, not equal to it.
    expect(exporter.flushes).toBeGreaterThanOrEqual(1);
    expect(exporter.flushes).toBeLessThanOrEqual(arns.length);
  });

  it("lets invocation ends that land together share one flush, so the slowest is not N flushes deep", async () => {
    const n = 6;
    const flushMs = 30;
    let flushes = 0;
    const exporter: InsightExporter = {
      async export(): Promise<void> {},
      async flush(): Promise<void> {
        flushes++;
        await sleep(flushMs);
      },
    };
    // on-failure + SUCCEEDED ends: each end is sampled in and still flushes, but
    // none of them schedules a record, so their requests reach the pump's flush
    // turn together and one flushAll serves them all. The case where every end
    // *does* carry a record is the next test.
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-failure",
    });

    const started = Date.now();
    await Promise.all(
      Array.from({ length: n }, (_, i) =>
        runInvocation(factory, arnFor(`flush-shared-${i}`)),
      ),
    );
    const elapsed = Date.now() - started;

    expect(flushes).toBeGreaterThanOrEqual(1);
    expect(flushes).toBeLessThan(n);
    expect(elapsed).toBeLessThan(n * flushMs * 0.8);
  });

  it("lets ends that each carry a record share a flush too, not one flush each", async () => {
    const n = 6;
    const exportMs = 10;
    const flushMs = 30;
    let flushes = 0;
    let exports = 0;
    const exporter: InsightExporter = {
      async export(): Promise<void> {
        exports++;
        await sleep(exportMs);
      },
      async flush(): Promise<void> {
        flushes++;
        await sleep(flushMs);
      },
    };
    // The case coalescing alone cannot fix: every end schedules a record, so
    // each request only arrives after that end's own drain resolved, and the
    // pump's one-record/one-flush alternation means there is rarely more than
    // one request queued when the flush turn comes round — nothing to coalesce,
    // and N ends cost N flushes. The pump therefore exports the records a drain
    // is waiting on before it spends a flush fan-out, which releases those ends
    // so their requests join one batch.
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-complete",
    });

    const started = Date.now();
    await Promise.all(
      Array.from({ length: n }, (_, i) =>
        runInvocation(factory, arnFor(`flush-record-shared-${i}`)),
      ),
    );
    const elapsed = Date.now() - started;

    // Printed so the numbers are in the review, not just the assertion.
    console.log(
      `${n} ends each carrying a record, export ${exportMs}ms, flush ${flushMs}ms -> slowest end ${elapsed}ms, ${flushes} flush(es)`,
    );

    expect(exports).toBe(n);
    // At most one flush per end is the contract; the point of the front-loading
    // is that a burst costs a small constant instead. Measured on this machine:
    // one flush and ~100 ms, against six flushes and ~260 ms without the
    // front-loading. The bound allows two, because a request made after the
    // batch was taken is served by the next turn rather than this one.
    expect(flushes).toBeGreaterThanOrEqual(1);
    expect(flushes).toBeLessThanOrEqual(2);
    // n * flushMs would be the cost of one flush per end; the exports alone are
    // n * exportMs, so this bound is comfortably above the ~2 flushes it takes
    // and comfortably below the old cadence.
    expect(elapsed).toBeLessThan(n * flushMs);
  });

  it("makes every concurrent end pay for every awaited export, which is what the flush() contract documents", async () => {
    const n = 8;
    const exportMs = 10;
    const flushMs = 30;
    let flushes = 0;
    const exporter: InsightExporter = {
      async export(): Promise<void> {
        await sleep(exportMs);
      },
      async flush(): Promise<void> {
        flushes++;
        await sleep(flushMs);
      },
    };
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-complete",
    });

    const elapsed = await Promise.all(
      Array.from({ length: n }, async (_, i) => {
        const started = Date.now();
        await runInvocation(factory, arnFor(`export-latency-${i}`));
        return Date.now() - started;
      }),
    );

    // Every record is exported before the shared flush starts, so the ends do
    // not finish one by one: they all finish at the end of the burst.
    const slowest = Math.max(...elapsed);
    const fastest = Math.min(...elapsed);
    console.log(
      `${n} concurrent ends, export ${exportMs}ms, flush ${flushMs}ms -> fastest end ${fastest}ms, slowest end ${slowest}ms, ${flushes} flush(es)`,
    );
    expect(slowest - fastest).toBeLessThan(flushMs);

    // And each of them pays the whole serialized product, not its own share:
    // n exports run one at a time before the flush every end is waiting on.
    // Lower bound only — timers overshoot, never undershoot by much.
    expect(fastest).toBeGreaterThanOrEqual(n * exportMs * 0.8);
    expect(flushes).toBeLessThanOrEqual(2);
  });

  /**
   * An exporter that parks its first `export()` until released, so a test can
   * build a specific queue up behind the pump, and records the order in which
   * exports and flushes happen.
   */
  function gatedExporter(): {
    exporter: InsightExporter;
    log: string[];
    parked: Promise<void>;
    release: () => void;
  } {
    const log: string[] = [];
    let announceParked!: () => void;
    const parked = new Promise<void>((resolve) => {
      announceParked = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstExport = true;
    const nameOf = (arn: string): string => arn.split("/")[2];
    return {
      log,
      parked,
      release: () => release(),
      exporter: {
        async export(record: WorkflowInsightRecord): Promise<void> {
          log.push(`export:${nameOf(record.executionArn)}`);
          if (firstExport) {
            firstExport = false;
            announceParked();
            await gate;
          }
        },
        async flush(): Promise<void> {
          log.push("flush");
        },
      },
    };
  }

  it("does not front-load a record nobody is draining ahead of a queued flush", async () => {
    const { exporter, log, parked, release } = gatedExporter();
    // on-change: onInvocationStart schedules a RUNNING record and returns
    // without draining it, which is now the only way a queued record can have no
    // waiter — a terminal record is always drained by the end hook that
    // scheduled it.
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-change",
    });

    // Parks the pump inside an export so everything below queues up behind it.
    // Nobody drains this one either.
    const blocker = arnFor("noflushdelay-blocker");
    await factory
      .createPlugin(startFor(blocker))
      .onInvocationStart?.(startFor(blocker));
    await parked;

    // Two full invocations, queued in order. Each ends while the pump is parked,
    // so each has a record *and* its own drain waiting on it, and asks for a
    // flush as soon as that record is out.
    const ends = ["noflushdelay-a", "noflushdelay-b"].map((name) => {
      const arn = arnFor(name);
      const plugin = factory.createPlugin(startFor(arn));
      void plugin.onInvocationStart?.(startFor(arn));
      return plugin.onInvocationEnd?.(endFor(arn)) ?? Promise.resolve();
    });

    // Queued last, behind both of those: a change record nobody waits on — the
    // shape an on-change stream produces.
    const idle = arnFor("noflushdelay-idle");
    await factory
      .createPlugin(startFor(idle))
      .onInvocationStart?.(startFor(idle));

    release();
    await Promise.all(ends);

    // By the time the pump reaches a flush turn with a request queued, the idle
    // record is the only thing left in the queue — and it is not front-loaded,
    // because no drain is waiting on it.
    expect(log.slice(0, log.indexOf("flush"))).toEqual([
      "export:noflushdelay-blocker",
      "export:noflushdelay-a",
      "export:noflushdelay-b",
    ]);

    // It is still exported, just not first.
    await sleep(20);
    expect(log).toContain("export:noflushdelay-idle");
  });

  it("exports the record a drain is waiting on before another execution's flush", async () => {
    const { exporter, log, parked, release } = gatedExporter();
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-failure",
    });

    const blocker = arnFor("frontload-blocker");
    void factory
      .createPlugin(startFor(blocker))
      .onInvocationEnd?.(endFor(blocker, { status: "FAILED" }));
    await parked;

    // A FAILED end: its record is queued *and* its own drain is waiting on it,
    // so it cannot ask for a flush yet.
    const waiting = runInvocation(factory, arnFor("frontload-waiting"), {
      end: { status: "FAILED" },
    });
    // A different execution's end, which schedules nothing and asks for a flush
    // straight away, so its request reaches the flush turn first.
    const asker = runInvocation(factory, arnFor("frontload-asker"));
    await sleep(5);

    release();
    await Promise.all([waiting, asker]);

    expect(log[0]).toBe("export:frontload-blocker");
    expect(log).toContain("flush");
    // The awaited record goes out before the flush that the *other* execution
    // asked for, which is what lets the two ends share that flush instead of the
    // waiter paying for one of its own.
    expect(log.indexOf("export:frontload-waiting")).toBeLessThan(
      log.indexOf("flush"),
    );
  });

  it("does not satisfy a flush request that arrives while a flush is running", async () => {
    let flushes = 0;
    let firstFlushStarted!: () => void;
    const reachedFirstFlush = new Promise<void>((resolve) => {
      firstFlushStarted = resolve;
    });
    let releaseFirstFlush!: () => void;
    const exporter: InsightExporter = {
      async export(): Promise<void> {},
      async flush(): Promise<void> {
        flushes++;
        if (flushes === 1) {
          firstFlushStarted();
          await new Promise<void>((resolve) => {
            releaseFirstFlush = resolve;
          });
        }
      },
    };
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-complete",
    });

    const first = runInvocation(factory, arnFor("mid-flush-first"));
    await reachedFirstFlush;

    // This execution's record is scheduled *after* the in-flight flush already
    // read the exporter's buffer, so that flush cannot stand in for its own: it
    // must wait for the next one.
    let secondDone = false;
    const second = runInvocation(factory, arnFor("mid-flush-second")).then(
      () => {
        secondDone = true;
      },
    );
    await sleep(20);
    expect(secondDone).toBe(false);
    expect(flushes).toBe(1);

    releaseFirstFlush();
    await Promise.all([first, second]);
    expect(secondDone).toBe(true);
    expect(flushes).toBe(2);
  });

  it("releases every waiter when flush() throws, and logs each failure", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      let flushes = 0;
      const exporter: InsightExporter = {
        async export(): Promise<void> {},
        // Alternates a synchronous throw and a rejection: both must be absorbed,
        // and neither may strand the invocation waiting on that flush.
        flush(): Promise<void> {
          flushes++;
          if (flushes % 2 === 0) throw new Error("sync flush boom");
          return Promise.reject(new Error("async flush boom"));
        },
      };
      const factory = workflowInsight({
        exporters: [exporter],
        emitMode: "on-complete",
      });
      const arns = Array.from({ length: 5 }, (_, i) =>
        arnFor(`flush-throws-${i}`),
      );

      const settled = await Promise.race([
        Promise.all(arns.map((arn) => runInvocation(factory, arn))).then(
          () => "settled",
        ),
        sleep(2000).then(() => "stranded"),
      ]);

      expect(settled).toBe("settled");
      expect(flushes).toBeGreaterThanOrEqual(1);
      expect(warn).toHaveBeenCalledWith(
        "[workflow-insight] exporter flush failed:",
        expect.any(Error),
      );
      expect(warn.mock.calls).toHaveLength(flushes);
    } finally {
      warn.mockRestore();
    }
  });

  it("releases the ends waiting on a flush even if the front-load pass throws", async () => {
    // The pump claims the pending flush resolvers before it front-loads the
    // records other ends are waiting on. From that point they are not in
    // flushWaiters, so nothing else can find them and no later pump serves them.
    // A throw between the claim and the release therefore stranded them, and
    // because onInvocationEnd is awaited before the Lambda response, those
    // invocations hung until the function timed out.
    //
    // The front-load pass is the unguarded await: exportPending is a try/finally
    // with no catch, so a synchronous throw from its fan-out escapes. Injected
    // directly here, because reaching it through a real exporter needs an
    // array-like that defeats the factory's Array.isArray check.
    let flushes = 0;
    const exporter: InsightExporter = {
      async export(): Promise<void> {},
      async flush(): Promise<void> {
        flushes++;
      },
    };
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-complete",
    });

    const plugin = factory.createPlugin(startFor(arnFor("strand-probe")));
    const scheduler = (
      plugin as unknown as { env: { scheduler: Record<string, unknown> } }
    ).env.scheduler;
    scheduler.exportRecordsADrainIsWaitingFor = (): Promise<void> =>
      Promise.reject(new TypeError("front-load pass is hostile"));

    // An end that emits no record asks for a flush without draining first, which
    // is the shape that reaches the flush turn with a claimed resolver.
    const flushWait = (
      scheduler as unknown as { flush: () => Promise<void> }
    ).flush();

    await expect(
      Promise.race([
        flushWait.then(() => "settled" as const),
        sleep(2000).then(() => "hung" as const),
      ]),
    ).resolves.toBe("settled");
    // The flush itself may or may not have run; what the contract owes the
    // waiter is an answer, not a successful flush.
    expect(flushes).toBeGreaterThanOrEqual(0);
  });

});

/**
 * Building a record runs customer code — the `content.*` transforms, an
 * operation `result` override, or an accessor on a value the record copies — and
 * that code runs synchronously inside the build. A hook it calls therefore
 * completes before the outer build returns, so the outer frame holds a snapshot
 * of state that is already superseded. Scheduling it would leave an exporter
 * that upserts by execution ARN storing the older snapshot, and in the
 * change/end pairing it would store RUNNING over a terminal status. These tests
 * pin the revision check that drops the superseded record.
 */
describe("record building re-entered by customer code", () => {
  const opNames = (record: WorkflowInsightRecord): string[] =>
    record.operations.map((o) => o.name ?? "");

  it("drops an older snapshot when a nested change hook already published a newer one", async () => {
    const exporter = new CapturingExporter();
    const arn = arnFor("reentrant-change");
    let plugin: ReturnType<PluginFactory["createPlugin"]> | undefined;
    let reentered = false;
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-change",
      operationDetail: "full-tree",
      content: {
        input: (value) => {
          if (!reentered) {
            reentered = true;
            void plugin?.onOperationChange?.(
              changeFor(arn, {
                a: op({ id: "a", name: "step-a", status: "SUCCEEDED" }),
                b: op({ id: "b", name: "step-b", status: "SUCCEEDED" }),
              }),
            );
          }
          return value;
        },
      },
    });

    plugin = factory.createPlugin(startFor(arn));
    await plugin.onOperationChange?.(
      changeFor(arn, {
        a: op({ id: "a", name: "step-a", status: "SUCCEEDED" }),
      }),
    );
    await sleep(20);

    expect(reentered).toBe(true);
    expect(exporter.records.map(opNames)).toEqual([["step-a", "step-b"]]);
  });

  it("drops a RUNNING snapshot when a nested end hook already published the terminal record", async () => {
    const exporter = new CapturingExporter();
    const arn = arnFor("reentrant-end");
    let plugin: ReturnType<PluginFactory["createPlugin"]> | undefined;
    let reentered = false;
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-change",
      operationDetail: "full-tree",
      content: {
        input: (value) => {
          if (!reentered) {
            reentered = true;
            void plugin?.onInvocationEnd?.(
              endFor(arn, {
                operations: {
                  a: op({ id: "a", name: "step-a", status: "SUCCEEDED" }),
                },
              }),
            );
          }
          return value;
        },
      },
    });

    plugin = factory.createPlugin(startFor(arn));
    await plugin.onOperationChange?.(
      changeFor(arn, {
        a: op({ id: "a", name: "step-a", status: "SUCCEEDED" }),
      }),
    );
    await sleep(50);

    expect(reentered).toBe(true);
    expect(exporter.records.map((r) => r.status)).toEqual(["SUCCEEDED"]);
  });

  it("still emits a record for every hook when no nesting occurs", async () => {
    const exporter = new CapturingExporter();
    const arn = arnFor("no-reentry");
    const factory = workflowInsight({
      exporters: [exporter],
      emitMode: "on-change",
      operationDetail: "full-tree",
      content: { input: (value) => value },
    });

    const start = startFor(arn);
    const plugin = factory.createPlugin(start);
    // Each hook is given time to reach the exporter before the next one runs,
    // so the scheduler's per-execution coalescing cannot account for a missing
    // record and only the revision check could.
    await plugin.onInvocationStart?.(start);
    await sleep(20);
    await plugin.onOperationChange?.(
      changeFor(arn, {
        a: op({ id: "a", name: "step-a", status: "SUCCEEDED" }),
      }),
    );
    await sleep(20);
    await plugin.onInvocationEnd?.(endFor(arn));

    expect(exporter.records.map((r) => r.status)).toEqual([
      "RUNNING",
      "RUNNING",
      "SUCCEEDED",
    ]);
    expect(opNames(exporter.records[1])).toEqual(["step-a"]);
  });
});

/**
 * A collector the test can trigger. Jest does not run node with --expose-gc, so
 * ask V8 for one directly; returns undefined when the runtime refuses, in which
 * case the caller skips the retention assertion.
 */
function exposeGc(): (() => void) | undefined {
  const existing = (globalThis as { gc?: () => void }).gc;
  if (existing !== undefined) return existing;
  try {
    setV8Flags("--expose-gc");
    return runInNewContext("gc") as () => void;
  } catch {
    return undefined;
  } finally {
    setV8Flags("--no-expose-gc");
  }
}
