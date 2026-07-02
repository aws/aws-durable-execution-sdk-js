import { workflowInsight } from "./index";
import type {
  InsightExporter,
  OperationResult,
  WorkflowInsightRecord,
} from "./types";
import type {
  DurableExecutionInvocationOutput,
  DurableInstrumentationPlugin,
  InvocationEndInfo,
  InvocationInfo,
  OperationInfo,
} from "@aws/durable-execution-sdk-js";

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

// Exports are fire-and-forget; wrapInvocation drains the shared scheduler.
async function drain(plugin: DurableInstrumentationPlugin): Promise<void> {
  await plugin.wrapInvocation?.(
    {
      executionArn: ARN,
      requestId: "req-1",
      isFirstInvocation: true,
      executionInput: undefined,
      operations: {},
    } as InvocationInfo,
    async () => ({}) as unknown as DurableExecutionInvocationOutput,
  );
}

async function endAndDrain(
  plugin: DurableInstrumentationPlugin,
  info: InvocationEndInfo,
): Promise<void> {
  await plugin.onInvocationEnd?.(info);
  await drain(plugin);
}

describe("content filtering", () => {
  it("transforms input, omits output, filters operations, and gates results", async () => {
    const exporter = new CapturingExporter();
    const plugin = workflowInsight({
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
      plugin,
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

  it("includes input/output as-is and omits results by default (no content config)", async () => {
    const exporter = new CapturingExporter();
    const plugin = workflowInsight({ exporters: [exporter] });

    await endAndDrain(
      plugin,
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
    const plugin = workflowInsight({
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
      plugin,
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
    const plugin = workflowInsight({
      exporters: [exporter],
      content: {
        input: () => {
          throw new Error("redactor blew up");
        },
      },
    });

    await endAndDrain(
      plugin,
      endInfo({ status: "SUCCEEDED", executionInput: { secret: "x" } }),
    );

    expect(exporter.records[0].input).toBeUndefined();
  });
});

describe("operation detail capture", () => {
  it("captures per-operation error and attempt by default", async () => {
    const exporter = new CapturingExporter();
    const plugin = workflowInsight({ exporters: [exporter] });

    await endAndDrain(
      plugin,
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

describe("status mapping", () => {
  it("maps a suspended (PENDING) execution to RUNNING", async () => {
    const exporter = new CapturingExporter();
    const plugin = workflowInsight({
      exporters: [exporter],
      emitMode: "on-change",
    });

    await endAndDrain(plugin, endInfo({ status: "PENDING" }));

    expect(exporter.records[0].status).toBe("RUNNING");
  });
});

describe("emit modes", () => {
  it("on-complete emits only on terminal status (not on suspends)", async () => {
    const exporter = new CapturingExporter();
    const plugin = workflowInsight({
      exporters: [exporter],
      emitMode: "on-complete",
    });

    await endAndDrain(plugin, endInfo({ status: "PENDING" }));
    expect(exporter.records).toHaveLength(0);

    await endAndDrain(plugin, endInfo({ status: "SUCCEEDED" }));
    expect(exporter.records).toHaveLength(1);
    expect(exporter.records[0].status).toBe("SUCCEEDED");
  });

  it("on-failure emits only on FAILED", async () => {
    const exporter = new CapturingExporter();
    const plugin = workflowInsight({
      exporters: [exporter],
      emitMode: "on-failure",
    });

    await endAndDrain(plugin, endInfo({ status: "SUCCEEDED" }));
    expect(exporter.records).toHaveLength(0);

    await endAndDrain(plugin, endInfo({ status: "FAILED" }));
    expect(exporter.records).toHaveLength(1);
    expect(exporter.records[0].status).toBe("FAILED");
  });
});

describe("sampling", () => {
  // Build a distinct, replay-stable execution ARN for `name`.
  function arnFor(name: string): string {
    return `arn:aws:lambda:us-east-1:123456789012:function:fn:1/durable-execution/${name}/inv-1`;
  }

  function baseInfo(arn: string): InvocationInfo {
    return {
      executionArn: arn,
      requestId: "req-1",
      isFirstInvocation: true,
      executionInput: undefined,
      operations: {},
    } as InvocationInfo;
  }

  // Drive one full execution (terminal SUCCEEDED end + drain) through the
  // plugin using a single ARN, so wrapInvocation drains the record scheduled by
  // onInvocationEnd for that same execution.
  async function runExecution(
    plugin: DurableInstrumentationPlugin,
    arn: string,
    status: InvocationEndInfo["status"] = "SUCCEEDED",
  ): Promise<void> {
    await plugin.onInvocationEnd?.({
      ...baseInfo(arn),
      status,
      executionResult: undefined,
      operations: {},
    } as InvocationEndInfo);
    await plugin.wrapInvocation?.(
      baseInfo(arn),
      async () => ({}) as unknown as DurableExecutionInvocationOutput,
    );
  }

  const NAMES = Array.from({ length: 200 }, (_, i) => `exec-${i}`);

  it("emits for every execution when samplingRate is 1.0 or omitted", async () => {
    for (const rate of [undefined, 1.0]) {
      const exporter = new CapturingExporter();
      const plugin = workflowInsight({
        exporters: [exporter],
        samplingRate: rate,
      });
      for (const name of NAMES) await runExecution(plugin, arnFor(name));
      expect(exporter.records).toHaveLength(NAMES.length);
    }
  });

  it("emits for no execution when samplingRate is 0", async () => {
    const exporter = new CapturingExporter();
    const plugin = workflowInsight({ exporters: [exporter], samplingRate: 0 });
    for (const name of NAMES) await runExecution(plugin, arnFor(name));
    expect(exporter.records).toHaveLength(0);
  });

  it("partitions the population at a fractional rate (not all-or-nothing)", async () => {
    const exporter = new CapturingExporter();
    const plugin = workflowInsight({
      exporters: [exporter],
      samplingRate: 0.5,
    });
    for (const name of NAMES) await runExecution(plugin, arnFor(name));
    // Deterministic hash → stable count; assert a healthy split rather than an
    // exact number so the bound doesn't couple to the hash implementation.
    expect(exporter.records.length).toBeGreaterThan(NAMES.length * 0.25);
    expect(exporter.records.length).toBeLessThan(NAMES.length * 0.75);
  });

  it("is reproducible: identical ARNs yield identical decisions", async () => {
    const rate = 0.5;
    const decideAll = async (): Promise<Set<string>> => {
      const exporter = new CapturingExporter();
      const plugin = workflowInsight({
        exporters: [exporter],
        samplingRate: rate,
      });
      for (const name of NAMES) await runExecution(plugin, arnFor(name));
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
      const plugin = workflowInsight({
        exporters: [exporter],
        samplingRate: 0.5,
      });
      const arn = arnFor(name);
      await runExecution(plugin, arn);
      await runExecution(plugin, arn);
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
