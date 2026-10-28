import type { DurableLambdaHandler } from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import {
  context,
  propagation,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { resolve } from "node:path";

export function testChainedInvokeSuspension(
  view: "execution" | "invocation",
): void {
  describe(`${view} view case-27 child suspension`, () => {
    const exporter = new InMemorySpanExporter();
    let provider: NodeTracerProvider;
    let handler: DurableLambdaHandler;
    let targetHandler: DurableLambdaHandler;
    const previousMode = process.env.OTEL_PLUGIN_MODE;
    const previousTarget = process.env.OTEL_INVOKE_TARGET_FUNCTION_NAME;

    beforeAll(async () => {
      await LocalDurableTestRunner.setupTestEnvironment();
      trace.disable();
      context.disable();
      propagation.disable();
      provider = new NodeTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      provider.register();
      process.env.OTEL_PLUGIN_MODE = view;
      process.env.OTEL_INVOKE_TARGET_FUNCTION_NAME = "case27-target:1";
      ({ handler, targetHandler } = await import(
        resolve(
          __dirname,
          "../../../../aws-durable-execution-sdk-js-conformance-tests-otel/handlers/otel_27_chained_invoke_suspend.ts",
        )
      ));
    });

    afterAll(async () => {
      await provider.shutdown();
      trace.disable();
      context.disable();
      propagation.disable();
      if (previousMode === undefined) delete process.env.OTEL_PLUGIN_MODE;
      else process.env.OTEL_PLUGIN_MODE = previousMode;
      if (previousTarget === undefined)
        delete process.env.OTEL_INVOKE_TARGET_FUNCTION_NAME;
      else process.env.OTEL_INVOKE_TARGET_FUNCTION_NAME = previousTarget;
      await LocalDurableTestRunner.teardownTestEnvironment();
    });

    it.each([undefined, ""])(
      "fails before invoking a child when the target is %p",
      async (functionName) => {
        const environment = jest.replaceProperty(process, "env", {
          ...process.env,
          OTEL_INVOKE_TARGET_FUNCTION_NAME: functionName,
        });
        try {
          const runner = new LocalDurableTestRunner({
            handlerFunction: handler,
          });
          const result = await runner.run({
            payload: { scenario: "chained-invoke-suspend" },
          });

          expect(result.getStatus()).toBe("FAILED");
          expect(result.getError()).toMatchObject({
            errorType: "Error",
            errorMessage: "OTEL_INVOKE_TARGET_FUNCTION_NAME is required",
          });
          expect(
            result
              .getHistoryEvents()
              .filter((event) => event.EventType === "ChainedInvokeStarted"),
          ).toHaveLength(0);
        } finally {
          environment.restore();
        }
      },
    );

    it("keeps child wait continuation telemetry through caller completion", async () => {
      let releaseTarget!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseTarget = resolve;
      });
      const target = jest.fn<
        ReturnType<DurableLambdaHandler>,
        Parameters<DurableLambdaHandler>
      >(async (...args) => {
        await gate;
        return targetHandler(...args);
      });
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });
      runner.registerDurableFunction("case27-target:1", target);
      const input = {
        scenario: "chained-invoke-suspend",
        nested: { value: 42 },
      };
      const execution = runner.run({ payload: input });
      const invoke = runner.getOperation("otel-suspended-invoke");
      await invoke.waitForData(WaitingOperationStatus.STARTED);
      try {
        await runner.pauseExecution();
      } finally {
        releaseTarget();
      }
      await invoke.waitForData(WaitingOperationStatus.COMPLETED);
      await runner.resumeExecution();
      const result = await execution;
      expect(result.getStatus()).toBe("SUCCEEDED");
      expect(result.getResult()).toEqual(input);
      expect(result.getInvocations()).toHaveLength(2);
      expect(target).toHaveBeenCalledTimes(2);
      const spans = exporter.getFinishedSpans();
      const waits = spans.filter(
        (s) => s.name === "otel-suspended-target-wait",
      );
      expect(waits).toHaveLength(view === "invocation" ? 2 : 1);
      expect(
        new Set(waits.map((s) => s.attributes["durable.operation.id"])).size,
      ).toBe(1);
      const childArn = waits[0].attributes["durable.execution.arn"];
      const child = spans.filter(
        (s) =>
          s.name === "Invocation" &&
          s.attributes["durable.execution.arn"] === childArn,
      );
      expect(
        child.map((s) => s.attributes["durable.invocation.status"]),
      ).toEqual(["PENDING", "SUCCEEDED"]);
      expect(
        child.map((s) => s.attributes["durable.invocation.first"]),
      ).toEqual([true, false]);
      expect(waits[waits.length - 1].status.code).toBe(SpanStatusCode.OK);
      if (view === "invocation") {
        expect(waits[1].links[0].context.spanId).toBe(
          waits[0].spanContext().spanId,
        );
        expect(waits[1].parentSpanContext?.spanId).toBe(
          child[1].spanContext().spanId,
        );
      } else {
        expect(waits[0].links[0].context.spanId).toBe(
          child[1].spanContext().spanId,
        );
      }
      expect(result.getHistoryEvents().map((event) => event.EventType)).toEqual(
        [
          "ExecutionStarted",
          "ChainedInvokeStarted",
          "InvocationCompleted",
          "ChainedInvokeSucceeded",
          "InvocationCompleted",
          "ExecutionSucceeded",
        ],
      );
    }, 30000);
  });
}
