import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { ExecutionOtelPlugin } from "../execution-plugin";
import { InvocationOtelPlugin } from "../invocation-plugin";

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
};

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe.each([
  ["execution", ExecutionOtelPlugin],
  ["invocation", InvocationOtelPlugin],
] as const)("%s view callback error details", (_view, Plugin) => {
  it.each([
    [false, "none"],
    [false, "partial"],
    [false, "rich"],
    [true, "none"],
    [true, "partial"],
    [true, "rich"],
  ] as const)(
    "preserves failure semantics (resume=%s, details=%s)",
    async (resume, detailKind) => {
      const details = detailKind !== "none";
      const exporter = new InMemorySpanExporter();
      let provider!: NodeTracerProvider;
      const submitted = gate();
      const release = gate();
      const submitter = jest.fn(async () => {
        submitted.open();
        if (!resume) await release.opened;
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
        async (_, durable) =>
          durable.waitForCallback("failed-callback", submitter),
        { plugins: [plugin] },
      );
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });
      try {
        const execution = runner.run();
        await submitted.opened;
        const parent = runner.getOperation("failed-callback");
        await parent.waitForData(WaitingOperationStatus.STARTED);
        if (resume) await runner.pauseExecution();
        await parent.sendCallbackFailure(
          details
            ? detailKind === "partial"
              ? { ErrorData: "partial details" }
              : {
                  ErrorType: "ExternalFailure",
                  ErrorMessage: "external callback failed",
                }
            : undefined,
        );
        release.open();
        if (resume) await runner.resumeExecution();
        const result = await execution;
        expect(result.getStatus()).toBe("FAILED");
        expect(result.getInvocations()).toHaveLength(resume ? 2 : 1);
        expect(submitter).toHaveBeenCalledTimes(1);
        const leafOperation = parent
          .getChildOperations()
          ?.find((op) => op.getType() === "CALLBACK");
        expect(leafOperation?.getStatus()).toBe("FAILED");
        expect(parent.getStatus()).toBe("FAILED");
        const terminal = exporter
          .getFinishedSpans()
          .filter(
            (span) =>
              span.attributes["durable.operation.type"] === "CALLBACK" &&
              span.attributes["durable.operation.status"] === "FAILED",
          );
        expect(terminal).toHaveLength(1);
        expect(terminal[0].status.code).toBe(
          details ? SpanStatusCode.ERROR : SpanStatusCode.UNSET,
        );
        expect(
          terminal[0].events.filter((event) => event.name === "exception"),
        ).toHaveLength(details ? 1 : 0);
        const parentSpans = exporter
          .getFinishedSpans()
          .filter(
            (span) =>
              span.attributes["durable.operation.name"] === "failed-callback" &&
              span.attributes["durable.operation.status"] === "FAILED",
          );
        expect(parentSpans).toHaveLength(1);
        expect(parentSpans[0].status.code).toBe(SpanStatusCode.ERROR);
        expect(parentSpans[0].events[0].attributes?.["exception.message"]).toBe(
          detailKind === "rich"
            ? "external callback failed"
            : "Callback failed",
        );
      } finally {
        release.open();
        await provider.shutdown();
        trace.disable();
        context.disable();
      }
    },
    30000,
  );
  it("replays an errorless failed callback without repeating side effects or terminal export", async () => {
    const exporter = new InMemorySpanExporter();
    let provider!: NodeTracerProvider;
    const submitter = jest.fn(async () => undefined);
    const failures: Array<{ name: string; message: string }> = [];
    const plugin = new Plugin({
      contextExtractor: () => undefined,
      tracerProviderFactory: (ids) =>
        (provider = new NodeTracerProvider({
          idGenerator: ids(),
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        })),
    });
    const handler = withDurableExecution(
      async (_, durable) => {
        try {
          await durable.waitForCallback("failed-callback", submitter);
        } catch (error) {
          failures.push({
            name: (error as Error).name,
            message: (error as Error).message,
          });
        }
        const [later] = await durable.createCallback("after-failure");
        await later;
        return "replayed failure";
      },
      { plugins: [plugin] },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const completed = () =>
      exporter
        .getFinishedSpans()
        .filter(
          (span) =>
            span.attributes["durable.operation.type"] === "CALLBACK" &&
            span.attributes["durable.operation.status"] === "FAILED",
        );
    try {
      const execution = runner.run();
      const parent = runner.getOperation("failed-callback");
      await parent.waitForData(WaitingOperationStatus.STARTED);
      await runner.pauseExecution();
      await parent.sendCallbackFailure();
      await runner.resumeExecution();
      const later = runner.getOperation("after-failure");
      await later.waitForData(WaitingOperationStatus.STARTED);
      await runner.pauseExecution();
      expect(completed()).toHaveLength(1);
      await later.sendCallbackSuccess("continue");
      await runner.resumeExecution();
      const result = await execution;
      expect(result.getStatus()).toBe("SUCCEEDED");
      expect(result.getResult()).toBe("replayed failure");
      expect(result.getInvocations()).toHaveLength(3);
      expect(submitter).toHaveBeenCalledTimes(1);
      expect(failures).toEqual([
        { name: "CallbackExternalError", message: "Callback failed" },
        { name: "CallbackExternalError", message: "Callback failed" },
      ]);
      expect(parent.getStatus()).toBe("FAILED");
      expect(completed()).toHaveLength(1);
      expect(completed()[0].status.code).toBe(SpanStatusCode.UNSET);
      expect(completed()[0].events).toHaveLength(0);
    } finally {
      await provider.shutdown();
      trace.disable();
      context.disable();
    }
  }, 30000);
});
