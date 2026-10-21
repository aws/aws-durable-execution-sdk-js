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
import { createExecutionOtelPluginFactory } from "../execution-plugin";
import { createInvocationOtelPluginFactory } from "../invocation-plugin";

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
  ["execution", createExecutionOtelPluginFactory],
  ["invocation", createInvocationOtelPluginFactory],
] as const)("%s view caught callback failure", (_view, Plugin) => {
  it.each([false, true])(
    "keeps an ERROR leaf without an invented exception, including later replay (resume=%s)",
    async (resume) => {
      const exporter = new InMemorySpanExporter();
      let provider!: NodeTracerProvider;
      const enteredStep = gate();
      const releaseStep = gate();
      const savedStep = jest.fn(async () => {
        enteredStep.open();
        await releaseStep.opened;
        return "saved";
      });
      const failures: Array<{ name: string; message: string }> = [];
      const plugin = Plugin({
        contextExtractor: () => undefined,
        tracerProviderFactory: (ids) =>
          (provider = new NodeTracerProvider({
            idGenerator: ids(),
            spanProcessors: [new SimpleSpanProcessor(exporter)],
          })),
      });
      const handler = withDurableExecution(
        async (_, durable) => {
          const [callback] = await durable.createCallback("root-failure");
          await durable.step("saved", savedStep);
          try {
            await callback;
          } catch (error) {
            failures.push({
              name: (error as Error).name,
              message: (error as Error).message,
            });
          }
          const [later] = await durable.createCallback("later");
          await later;
          return "failure caught";
        },
        { plugins: [plugin] },
      );
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });
      const failedLeaves = () =>
        exporter
          .getFinishedSpans()
          .filter(
            (span) =>
              span.attributes["durable.operation.name"] === "root-failure" &&
              span.attributes["durable.operation.status"] === "FAILED",
          );
      try {
        const execution = runner.run();
        await enteredStep.opened;
        const callback = runner.getOperation("root-failure");
        await callback.waitForData(WaitingOperationStatus.STARTED);
        if (resume) {
          releaseStep.open();
          // Replay may skip this side effect only after its success is persisted.
          await runner
            .getOperation("saved")
            .waitForData(WaitingOperationStatus.COMPLETED);
          await runner.pauseExecution();
        }
        await callback.sendCallbackFailure();
        releaseStep.open();
        if (resume) await runner.resumeExecution();
        const later = runner.getOperation("later");
        await later.waitForData(WaitingOperationStatus.STARTED);
        await runner.pauseExecution();
        expect(failedLeaves()).toHaveLength(1);
        await later.sendCallbackSuccess("continue");
        await runner.resumeExecution();
        const result = await execution;

        expect(result.getStatus()).toBe("SUCCEEDED");
        expect(result.getResult()).toBe("failure caught");
        expect(result.getInvocations()).toHaveLength(resume ? 3 : 2);
        expect(savedStep).toHaveBeenCalledTimes(1);
        expect(failures).toEqual([
          { name: "CallbackExternalError", message: "Callback failed" },
          { name: "CallbackExternalError", message: "Callback failed" },
        ]);
        expect(callback.getStatus()).toBe("FAILED");
        expect(failedLeaves()).toHaveLength(1);
        expect(failedLeaves()[0].status).toEqual({
          code: SpanStatusCode.ERROR,
          message: "FAILED",
        });
        expect(failedLeaves()[0].events).toHaveLength(0);
        const workflow = exporter
          .getFinishedSpans()
          .find((span) => span.name === "Workflow");
        expect(workflow?.status.code).toBe(SpanStatusCode.OK);
      } finally {
        releaseStep.open();
        await provider.shutdown();
        trace.disable();
        context.disable();
      }
    },
    30000,
  );
});
