import {
  withDurableExecution,
  type InvocationInfo,
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
import { ExecutionOtelPlugin } from "../execution-plugin";
import { InvocationOtelPlugin } from "../invocation-plugin";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

it.each([ExecutionOtelPlugin, InvocationOtelPlugin])(
  "%p preserves a waitForCallback child's derived name before deferred export and replay",
  async (Plugin) => {
    let entered!: () => void;
    let release!: () => void;
    const live = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const starts: InvocationInfo[] = [];
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
        // Its checkpoint will skip this whole branch on subsequent invocations.
        child.waitForCallback("named", submitter);
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
    const plugin = new Plugin({
      contextExtractor: () => undefined,
      tracerProviderFactory: (ids) =>
        (provider = new NodeTracerProvider({
          idGenerator: ids(),
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        })),
    });
    const handler = withDurableExecution(
      async (_, ctx) => {
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
            async onInvocationStart(info) {
              starts.push(info);
            },
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
      const notification = starts.find((change) =>
        Object.values(change.updatedOperations).some(
          (info) =>
            info.type === "CALLBACK" &&
            info.status === "SUCCEEDED" &&
            info.parentId &&
            change.operations[info.parentId]?.name === "named",
        ),
      )!;
      expect(notification).toBeDefined();
      const raw = Object.values(notification.updatedOperations).find(
        (info) =>
          info.type === "CALLBACK" &&
          info.status === "SUCCEEDED" &&
          info.parentId &&
          notification.operations[info.parentId]?.name === "named",
      )!;
      // This name is deliberately absent from the checkpoint. Inferring display
      // metadata must not mutate the source event or rewrite durable identity.
      expect(raw.name).toBeUndefined();
      expect(notification.operations[raw.parentId!].subType).toBe(
        "WaitForCallback",
      );
      const terminal = exporter
        .getFinishedSpans()
        .filter(
          (span) =>
            span.attributes["durable.operation.id"] === raw.id &&
            span.attributes["durable.operation.status"] === "SUCCEEDED",
        );
      expect(terminal).toHaveLength(1);
      expect(terminal[0].name).toBe("named-callback");
      expect(terminal[0].attributes["durable.operation.name"]).toBe(
        "named-callback",
      );
      expect(terminal[0].parentSpanContext).toBeDefined();
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
