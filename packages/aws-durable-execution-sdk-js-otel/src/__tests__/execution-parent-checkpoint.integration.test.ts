import {
  withDurableExecution,
  DurableExecutionInvocationInputWithClient,
  type CheckpointDurableExecutionResponse,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { context, trace } from "@opentelemetry/api";
import { timeInputToHrTime } from "@opentelemetry/core";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { createExecutionOtelPluginFactory } from "../execution-plugin";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

it("retains the real context when an earlier callback completion arrives with its terminal checkpoint response", async () => {
  const exporter = new InMemorySpanExporter();
  let provider!: NodeTracerProvider;
  let runner!: LocalDurableTestRunner;
  let completedCallback = false;
  let childCalls = 0;
  const saved = jest.fn(async () => "saved");
  let parentEnded!: () => void;
  const parentEnd = new Promise<void>((resolve) => {
    parentEnded = resolve;
  });
  const order: string[] = [];
  const phases: string[] = [];
  const terminalResponses: CheckpointDurableExecutionResponse[] = [];
  const plugin = createExecutionOtelPluginFactory({
    contextExtractor: () => undefined,
    tracerProviderFactory: (ids) => {
      provider = new NodeTracerProvider({
        idGenerator: ids(),
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      return provider;
    },
  });
  const handler = withDurableExecution(
    async (_, ctx) => {
      const result = await ctx.runInChildContext("scope", async (child) => {
        childCalls++;
        await child.createCallback("external");
        return "submitted";
      });
      await ctx.step("saved", saved);
      const [later] = await ctx.createCallback("later");
      await later;
      return result;
    },
    {
      pluginsConfig: { childOperationsDepth: 1 },
      plugins: [
        plugin,
        {
          createPlugin: () => ({
            async onOperationEnd(info) {
              if (info.name === "scope") {
                order.push("parent-end-hook");
                parentEnded();
              }
            },
            async onOperationChange(info) {
              if (
                Object.values(info.updatedOperations).some(
                  (op) => op.name === "external" && op.status === "SUCCEEDED",
                )
              ) {
                order.push("callback-change-hook");
              }
            },
          }),
        },
      ],
    },
  );
  runner = new LocalDurableTestRunner({
    handlerFunction: async (event, lambdaContext) => {
      if (!DurableExecutionInvocationInputWithClient.isInstance(event)) {
        throw new Error("Expected the local runner's transport");
      }
      const client = event.durableExecutionClient;
      const checkpoint = client.checkpoint.bind(client);
      // Decorate the real transport only to control delivery. The callback API
      // changes backend state; no checkpoint, response, timestamp or hook is made up.
      client.checkpoint = async (...args) => {
        const request = args[0];
        const updates = request.Updates ?? [];
        const callbackStart = updates.some(
          (op) =>
            op.Type === "CALLBACK" &&
            op.Name === "external" &&
            op.Action === "START",
        );
        const parentSuccess = updates.some(
          (op) =>
            op.Type === "CONTEXT" &&
            op.Name === "scope" &&
            op.Action === "SUCCEED",
        );
        const requestSnapshot = JSON.stringify(request);
        const response = await checkpoint(...args);
        expect(JSON.stringify(request)).toBe(requestSnapshot);
        const responseSnapshot = JSON.stringify(response);
        if (callbackStart && !completedCallback) {
          completedCallback = true;
          const external = runner.getOperation("external");
          await external.waitForData(WaitingOperationStatus.STARTED);
          await external.sendCallbackSuccess("external result");
          order.push("callback-completed-in-backend");
        }
        if (parentSuccess) {
          await parentEnd;
          terminalResponses.push(structuredClone(response));
          order.push("parent-terminal-response-delivered");
        }
        expect(JSON.stringify(response)).toBe(responseSnapshot);
        return response;
      };
      const output = await handler(event, lambdaContext);
      phases.push(output.Status);
      return output;
    },
  });
  try {
    const execution = runner.run();
    const later = runner.getOperation("later");
    await later.waitForData(WaitingOperationStatus.STARTED);
    await runner.pauseExecution();
    await later.sendCallbackSuccess("continue");
    await runner.resumeExecution();
    const result = await execution;
    expect(result.getStatus()).toBe("SUCCEEDED");
    expect(result.getResult()).toBe("submitted");
    expect(phases).toEqual(["PENDING", "SUCCEEDED"]);
    expect(childCalls).toBe(2);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(
      runner.getOperation("scope").getOperationData()?.ContextDetails
        ?.ReplayChildren,
    ).toBe(true);
    expect(order).toEqual([
      "callback-completed-in-backend",
      "parent-end-hook",
      "parent-terminal-response-delivered",
      "callback-change-hook",
    ]);
    expect(terminalResponses).toHaveLength(1);
    const operations = terminalResponses[0].NewExecutionState!.Operations!;
    const child = operations.find((op) => op.Name === "external")!;
    const parent = operations.find((op) => op.Name === "scope")!;
    expect(child.Status).toBe("SUCCEEDED");
    expect(parent.Status).toBe("SUCCEEDED");
    expect(child.ParentId).toBe(parent.Id);
    // These actual backend dates establish the input race, not a timestamp
    // comparison policy for choosing the parent in the plugin.
    expect(new Date(child.EndTimestamp!).getTime()).toBeLessThanOrEqual(
      new Date(parent.EndTimestamp!).getTime(),
    );
    const spans = exporter.getFinishedSpans();
    const callbacks = spans.filter(
      (span) =>
        span.name === "external" &&
        span.attributes["durable.operation.status"] === "SUCCEEDED",
    );
    const parents = spans.filter((span) => span.name === "scope");
    expect(callbacks).toHaveLength(1);
    expect(parents).toHaveLength(1);
    expect(callbacks[0].parentSpanContext?.spanId).toBe(
      parents[0].spanContext().spanId,
    );
    expect(callbacks[0].attributes["durable.operation.id"]).toBe(child.Id);
    expect(callbacks[0].startTime).toEqual(
      timeInputToHrTime(new Date(child.StartTimestamp!).getTime()),
    );
    expect(callbacks[0].endTime).toEqual(
      timeInputToHrTime(new Date(child.EndTimestamp!).getTime()),
    );
  } finally {
    parentEnded();
    await provider.shutdown();
    trace.disable();
    context.disable();
  }
}, 30000);
