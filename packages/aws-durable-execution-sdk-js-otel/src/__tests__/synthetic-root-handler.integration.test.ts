import {
  withDurableExecution,
  type InvocationInfo,
} from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  InMemorySpanExporter,
  NodeTracerProvider,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-node";
import { ExecutionOtelPlugin } from "../execution-plugin";
import { InvocationOtelPlugin } from "../invocation-plugin";

// Capture ended span content when it crosses the exporter boundary. Resource
// ownership is unchanged; the SDK-owned span body must match on re-export.
function snapshot(span: ReadableSpan) {
  const context = span.spanContext();
  return {
    name: span.name,
    kind: span.kind,
    traceId: context.traceId,
    spanId: context.spanId,
    traceFlags: context.traceFlags,
    traceState: context.traceState?.serialize(),
    parentSpanId: span.parentSpanContext?.spanId,
    startTime: [...span.startTime],
    endTime: [...span.endTime],
    duration: [...span.duration],
    attributes: { ...span.attributes },
    status: { ...span.status },
    links: [...span.links],
    events: [...span.events],
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
    instrumentationScope: { ...span.instrumentationScope },
    ended: span.ended,
  };
}

type SpanSnapshot = ReturnType<typeof snapshot>;

class RecordingExporter extends InMemorySpanExporter {
  readonly batches: SpanSnapshot[][] = [];
  private failNextExport: boolean;

  constructor(failFirstExport = false) {
    super();
    this.failNextExport = failFirstExport;
  }

  override export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    if (this.failNextExport) {
      this.failNextExport = false;
      resultCallback({
        code: ExportResultCode.FAILED,
        error: new Error("first export lost"),
      });
      return;
    }
    this.batches.push(spans.map(snapshot));
    super.export(spans, resultCallback);
  }
}

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: false }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

it.each(
  [ExecutionOtelPlugin, InvocationOtelPlugin].flatMap((Plugin) =>
    [false, true].map((failFirstExport) => ({
      Plugin,
      view: Plugin.name,
      failFirstExport,
    })),
  ),
)(
  "$view anchors public SDK resumes before terminal completion (first export lost=$failFirstExport)",
  async ({ Plugin, failFirstExport }) => {
    const exporter = new RecordingExporter(failFirstExport);
    let provider: NodeTracerProvider | undefined;
    const plugin = new Plugin({
      contextExtractor: () => undefined,
      tracerProviderFactory: (createIdGenerator) => {
        provider = new NodeTracerProvider({
          idGenerator: createIdGenerator(),
          sampler: new AlwaysOnSampler(),
          spanProcessors: [
            new BatchSpanProcessor(exporter, {
              // Longer than this test's timeout; only the plugin's awaited
              // invocation-end flush can deliver the first small batch.
              scheduledDelayMillis: 120_000,
              maxExportBatchSize: 512,
              maxQueueSize: 2048,
            }),
          ],
        });
        return provider;
      },
    });
    let stepCalls = 0;
    const firstInvocations: boolean[] = [];
    const handler = withDurableExecution(
      async (_event, context) => {
        const result = await context.step("work-once", async () => {
          stepCalls++;
          return { value: "stored result" };
        });
        await context.wait("suspend", { seconds: 1 });
        await context.wait("suspend-again", { seconds: 1 });
        return result;
      },
      {
        plugins: [
          plugin,
          {
            onInvocationStart: async (info: InvocationInfo) => {
              firstInvocations.push(info.isFirstInvocation);
            },
          },
        ],
      },
    );
    const returned: { status: string; batches: SpanSnapshot[][] }[] = [];
    const runner = new LocalDurableTestRunner({
      handlerFunction: async (event, context) => {
        const output = await handler(event, context);
        // Observe after the real wrapper has awaited every hook. A second
        // observer plugin would race the OTel plugin's concurrent end hook.
        returned.push({
          status: output.Status,
          batches: exporter.batches.map((batch) => [...batch]),
        });
        return output;
      },
    });
    try {
      const result = await runner.run();
      expect(result.getResult()).toEqual({ value: "stored result" });
      expect(stepCalls).toBe(1);
      expect(returned[0].status).toBe("PENDING");
      expect(returned.at(-1)?.status).toBe("SUCCEEDED");
      expect(firstInvocations[0]).toBe(true);
      expect(firstInvocations.slice(1).every((first) => !first)).toBe(true);
      const suspended = returned.filter(
        (invocation) => invocation.status === "PENDING",
      );
      expect(suspended.length).toBeGreaterThanOrEqual(2);

      const atFirstReturn = returned[0].batches.flat();
      const firstRoots = atFirstReturn.filter(
        (span) => span.name === "DurableExecutionRoot",
      );
      expect(firstRoots).toHaveLength(failFirstExport ? 0 : 1);
      if (!failFirstExport) {
        expect(atFirstReturn.some((span) => span.name === "Invocation")).toBe(
          true,
        );
      }
      const allExported = exporter.batches.flat();
      const roots = allExported.filter(
        (span) => span.name === "DurableExecutionRoot",
      );
      const firstRoot = roots[0];
      expect(firstRoot.ended).toBe(true);
      expect(firstRoot.startTime).toEqual(firstRoot.endTime);
      expect(firstRoot.duration).toEqual([0, 0]);
      expect(firstRoot.parentSpanId).toBeUndefined();
      expect(
        atFirstReturn.filter((span) => span.name === "Workflow"),
      ).toHaveLength(0);

      // Check the real second PENDING boundary, before any terminal SDK hook.
      // This remains useful even if the service subsequently stops the execution.
      const beforeTerminal = suspended[1].batches.flat();
      const recoveredRoots = beforeTerminal.filter(
        (span) => span.name === "DurableExecutionRoot",
      );
      expect(recoveredRoots).toHaveLength(failFirstExport ? 1 : 2);
      expect(firstRoot.attributes["durable.execution.arn"]).toBeDefined();
      expect(
        beforeTerminal.filter((span) => span.name === "Workflow"),
      ).toHaveLength(0);
      expect(roots).toHaveLength(returned.length - Number(failFirstExport));
      for (const root of roots) expect(root).toEqual(firstRoot);
      const workflows = allExported.filter((span) => span.name === "Workflow");
      expect(workflows).toHaveLength(1);
      const workflow = workflows[0];
      expect(workflow.ended).toBe(true);
      expect(workflow.parentSpanId).toBe(firstRoot.spanId);
      expect(workflow.traceId).toBe(firstRoot.traceId);
      expect(workflow.startTime).toEqual(firstRoot.startTime);
      expect(workflow.duration[0] * 1e9 + workflow.duration[1]).toBeGreaterThan(
        0,
      );
      expect(workflow.attributes["durable.execution.status"]).toBe("SUCCEEDED");
    } finally {
      // Cleanup only, after all assertions; never manually flush to make the
      // first-return export assertion pass.
      await provider?.shutdown();
    }
  },
  20_000,
);
