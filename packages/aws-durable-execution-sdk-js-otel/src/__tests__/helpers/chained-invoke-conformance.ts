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

export function testChainedInvokeReplay(
  view: "execution" | "invocation",
): void {
  describe(`${view} view case-11 replay`, () => {
    const exporter = new InMemorySpanExporter();
    let provider: NodeTracerProvider;
    let handler: DurableLambdaHandler;
    let targetHandler: DurableLambdaHandler;
    const previousMode = process.env.OTEL_PLUGIN_MODE;
    const previousTarget = process.env.OTEL_INVOKE_TARGET_FUNCTION_NAME;

    beforeAll(async () => {
      LocalDurableTestRunner.setupTestEnvironment();
      trace.disable();
      context.disable();
      propagation.disable();
      provider = new NodeTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      provider.register();
      process.env.OTEL_PLUGIN_MODE = view;
      process.env.OTEL_INVOKE_TARGET_FUNCTION_NAME = "case11-target:1";
      ({ handler, targetHandler } = await import(
        resolve(
          __dirname,
          "../../../../aws-durable-execution-sdk-js-conformance-tests-otel/handlers/otel_11_chained_invoke.ts",
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

    it("replays the completed invoke without another child or terminal export", async () => {
      const target = jest.fn(targetHandler);
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });
      runner.registerDurableFunction("case11-target:1", target);
      const input = { scenario: "chained-invoke", nested: { value: 42 } };
      const execution = runner.run({ payload: input });
      const invoke = runner.getOperation("otel-invoke");
      const barrier = runner.getOperation("otel-invoke-replay-barrier");
      await barrier.waitForData(WaitingOperationStatus.SUBMITTED);
      await runner.pauseExecution();

      const completedInvokes = (): ReturnType<
        InMemorySpanExporter["getFinishedSpans"]
      > =>
        exporter
          .getFinishedSpans()
          .filter(
            (span) =>
              span.name === "otel-invoke" &&
              span.attributes["durable.operation.status"] === "SUCCEEDED",
          );
      expect(target).toHaveBeenCalledTimes(1);
      expect(invoke.getStatus()).toBe("SUCCEEDED");
      expect(completedInvokes()).toHaveLength(1);
      const completed = completedInvokes()[0];
      const invokeId = invoke.getId();
      const executionArn = completed.attributes["durable.execution.arn"];

      await barrier.sendCallbackSuccess(JSON.stringify("resume"));
      await runner.resumeExecution();
      const result = await execution;

      expect(result.getStatus()).toBe("SUCCEEDED");
      expect(result.getResult()).toEqual(input);
      expect(result.getInvocations()).toHaveLength(3);
      expect(target).toHaveBeenCalledTimes(1);
      expect(invoke.getId()).toBe(invokeId);
      expect(completedInvokes()).toEqual([completed]);
      expect(completed.status.code).toBe(SpanStatusCode.OK);
      expect(
        exporter
          .getFinishedSpans()
          .filter(
            (span) =>
              span.name === "Invocation" &&
              span.attributes["durable.execution.arn"] === executionArn,
          )
          .map((span) => span.attributes["durable.invocation.status"]),
      ).toEqual(["PENDING", "PENDING", "SUCCEEDED"]);
      expect(result.getHistoryEvents().map((event) => event.EventType)).toEqual(
        [
          "ExecutionStarted",
          "ChainedInvokeStarted",
          "InvocationCompleted",
          "ChainedInvokeSucceeded",
          "ContextStarted",
          "CallbackStarted",
          "StepStarted",
          "StepSucceeded",
          "InvocationCompleted",
          "CallbackSucceeded",
          "ContextSucceeded",
          "InvocationCompleted",
          "ExecutionSucceeded",
        ],
      );
    }, 30000);
  });
}
