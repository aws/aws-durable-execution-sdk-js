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
