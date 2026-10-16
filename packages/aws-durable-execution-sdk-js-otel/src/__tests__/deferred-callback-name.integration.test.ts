import {
  withDurableExecution,
  type InvocationInfo,
  type OperationInfo,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { context, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { createExecutionOtelPluginFactory } from "../execution-plugin";
import { createInvocationOtelPluginFactory } from "../invocation-plugin";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

it.each(
  [createExecutionOtelPluginFactory, createInvocationOtelPluginFactory].flatMap(
    (Plugin) =>
      [false, true].map((callbackAtRoot) => ({ Plugin, callbackAtRoot })),
  ),
)(
  "$Plugin preserves service-visible callback names (callbackAtRoot=$callbackAtRoot)",
  async ({ Plugin, callbackAtRoot }) => {
    let entered!: () => void;
    let release!: () => void;
    const live = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const starts: InvocationInfo[] = [];
    const operations: OperationInfo[] = [];
    const exporter = new InMemorySpanExporter();
    let provider!: NodeTracerProvider;
    let submitted!: () => void;
    const submission = new Promise<void>((resolve) => {
      submitted = resolve;
    });
    const submitter = jest.fn(async () => {
      submitted();
    });
    const childBody = jest.fn(
      async (child: import("@aws/durable-execution-sdk-js").DurableContext) => {
        // The outer child can finish before the external operation completes.
        // Descendants of this completed small context are omitted on replay.
        // A root waitForCallback remains STARTED, so its completion stays visible.
        if (!callbackAtRoot) child.waitForCallback("named", submitter);
        await child.step("submitted", async () => {
          await submission;
          return "submitted";
        });
        return "submitted";
      },
    );
    const step = jest.fn(async () => {
      entered();
      await released;
      return "saved";
    });
    const plugin = Plugin({
      contextExtractor: () => undefined,
      tracerProviderFactory: (ids) =>
        (provider = new NodeTracerProvider({
          idGenerator: ids(),
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        })),
    });
    const handler = withDurableExecution(
      async (_, ctx) => {
        if (callbackAtRoot) ctx.waitForCallback("named", submitter);
        const outcome = await ctx.runInChildContext("scope", childBody);
        await ctx.step("saved", step);
        const [later] = await ctx.createCallback("later");
        await later;
        return { outcome };
      },
      {
        plugins: [
          plugin,
          {
            createPlugin: () => ({
              async onInvocationStart(info) {
                starts.push(info);
              },
              async onOperationStart(info) {
                operations.push(info);
              },
            }),
          },
        ],
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    try {
      const execution = runner.run();
      await live;
      const named = runner.getOperation("named");
      await named.waitForData(WaitingOperationStatus.STARTED);
      const paused = runner.pauseExecution();
      release();
      await paused;
      await named.sendCallbackSuccess("accepted");
      await runner.resumeExecution();
      const later = runner.getOperation("later");
      await later.waitForData(WaitingOperationStatus.STARTED);
      await runner.pauseExecution();
      await later.sendCallbackSuccess("continue");
      await runner.resumeExecution();
      const result = await execution;
      expect(result.getResult()).toEqual({ outcome: "submitted" });
      expect(childBody).toHaveBeenCalledTimes(1);
      expect(submitter).toHaveBeenCalledTimes(1);
      expect(step).toHaveBeenCalledTimes(1);
      const callback = operations.find(
        (info) => info.type === "CALLBACK" && info.name === "named-callback",
      )!;
      expect(callback).toBeDefined();
      const notification = starts.find(
        (change) =>
          change.updatedOperations[callback.id]?.status === "SUCCEEDED",
      );
      const terminal = exporter
        .getFinishedSpans()
        .filter(
          (span) =>
            span.attributes["durable.operation.id"] === callback.id &&
            span.attributes["durable.operation.status"] === "SUCCEEDED",
        );
      if (!callbackAtRoot) {
        // The service omits this completed context's descendants. Missing
        // completion metadata cannot be reconstructed into a notification/span.
        expect(notification).toBeUndefined();
        for (const start of starts.slice(1)) {
          expect(start.operations[callback.id]).toBeUndefined();
          expect(start.updatedOperations[callback.id]).toBeUndefined();
        }
        expect(terminal).toHaveLength(0);
        return;
      }
      expect(notification).toBeDefined();
      const raw = notification!.updatedOperations[callback.id];
      // Inferring display metadata must not mutate the source event or rewrite
      // durable identity. The wire callback deliberately has no name.
      expect(raw.name).toBeUndefined();
      expect(notification!.operations[raw.parentId!].name).toBe("named");
      expect(notification!.operations[raw.parentId!].subType).toBe(
        "WaitForCallback",
      );
      expect(terminal).toHaveLength(1);
      expect(terminal[0].name).toBe("named-callback");
      expect(terminal[0].attributes["durable.operation.name"]).toBe(
        "named-callback",
      );
      expect(terminal[0].parentSpanContext).toBeDefined();
      expect(
        exporter
          .getFinishedSpans()
          .some(
            (span) =>
              span.spanContext().spanId ===
              terminal[0].parentSpanContext?.spanId,
          ),
      ).toBe(true);
      expect(terminal[0].spanContext().traceId).toMatch(/^[a-f0-9]{32}$/);
    } finally {
      release();
      await provider.shutdown();
      trace.disable();
      context.disable();
    }
  },
  30000,
);
