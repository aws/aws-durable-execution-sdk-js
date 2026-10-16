import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import type {
  InvocationInfo,
  PropagationInput,
} from "@aws/durable-execution-sdk-js";
import {
  withDurableExecution,
  DurableExecutionInvocationInputWithClient,
  OperationType,
  OperationStatus,
} from "@aws/durable-execution-sdk-js";
import type {
  CheckpointDurableExecutionRequest,
  DurableExecutionClient,
  WireOperation,
} from "@aws/durable-execution-sdk-js";
import type { Context } from "aws-lambda";
import { context, trace, ROOT_CONTEXT, TraceFlags } from "@opentelemetry/api";
import {
  AlwaysOnSampler,
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { ExecutionOtelPlugin } from "../execution-plugin";
import { InvocationOtelPlugin } from "../invocation-plugin";
import { deriveSpanIdFromOperationId } from "../deterministic-id-generator";
import { parseXRayTraceHeader } from "../context-extractors";

import type * as PluginRunner from "../../../aws-durable-execution-sdk-js/dist-types/utils/plugin/plugin-runner";

const { createPluginRunner } = jest.requireActual<typeof PluginRunner>(
  "../../../aws-durable-execution-sdk-js/src/utils/plugin/plugin-runner",
);

const info: InvocationInfo = {
  requestId: "req",
  executionArn: "arn:execution:one",
  isFirstInvocation: true,
  executionInput: {},
  operations: {},
  updatedOperations: {},
  executionStartTimestamp: new Date("2026-01-01T00:00:00Z"),
};
const input: PropagationInput = Object.freeze({
  executionArn: info.executionArn,
  operationId: "invoke-one",
  parentOperationId: "parent-context",
  targetFunctionName: "callee:1",
});
const upstreamTrace = "5759e988bd862e3fe1be46a994272793";

describe.each([ExecutionOtelPlugin, InvocationOtelPlugin])(
  "%p propagation metadata",
  (Plugin) => {
    let exporter: InMemorySpanExporter;
    let provider: NodeTracerProvider;
    beforeEach(() => {
      context.setGlobalContextManager(
        new AsyncLocalStorageContextManager().enable(),
      );
    });
    afterEach(async () => {
      await provider?.shutdown();
      trace.disable();
      context.disable();
    });
    function make(sampling?: "SAMPLED" | "NOT_SAMPLED") {
      exporter = new InMemorySpanExporter();
      return new Plugin({
        contextExtractor: () =>
          sampling
            ? {
                traceId: upstreamTrace,
                parentSpanId: "53995c3f42cd8ad8",
                sampling,
              }
            : undefined,
        tracerProviderFactory: (ids) =>
          (provider = new NodeTracerProvider({
            idGenerator: ids(),
            sampler: new AlwaysOnSampler(),
            spanProcessors: [new SimpleSpanProcessor(exporter)],
          })),
      });
    }
    it.each(["SAMPLED", "NOT_SAMPLED", undefined] as const)(
      "encodes the actual operation identity and resolved sampling (%s) without extra spans",
      async (sampling) => {
        const plugin = make(sampling);
        expect(plugin.providePropagationMetadata(input)).toBeUndefined();
        await plugin.onInvocationStart(info);
        const started = jest.spyOn(
          provider.getTracer("aws-durable-execution-sdk-js"),
          "startSpan",
        );
        const unrelated = trace.setSpanContext(ROOT_CONTEXT, {
          traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          spanId: "aaaaaaaaaaaaaaaa",
          traceFlags: TraceFlags.SAMPLED,
        });
        const runner = createPluginRunner([{}, plugin]);
        const metadata = context.with(unrelated, () => {
          expect(context.active()).toBe(unrelated);
          return runner.providePropagationMetadata?.(input);
        });
        expect(started).not.toHaveBeenCalled();
        expect(Object.isFrozen(metadata)).toBe(true);
        const parsed = parseXRayTraceHeader(metadata?.xAmznTraceId);
        expect(parsed?.parentSpanId).toBe(
          deriveSpanIdFromOperationId(input.operationId, input.executionArn),
        );
        expect(parsed?.sampling).toBe(
          sampling === "NOT_SAMPLED" ? "NOT_SAMPLED" : "SAMPLED",
        );
        if (sampling) expect(parsed?.traceId).toBe(upstreamTrace);
        const operation = {
          id: input.operationId,
          type: "CHAINED_INVOKE",
          name: "call",
          parentId: input.parentOperationId,
          isReplay: false,
        };
        await plugin.onOperationStart(operation);
        await plugin.onOperationEnd({ ...operation, status: "SUCCEEDED" });
        await plugin.onInvocationEnd({ ...info, status: "SUCCEEDED" });
        expect(plugin.providePropagationMetadata(input)).toBeUndefined();
        const spans = exporter.getFinishedSpans();
        if (sampling === "NOT_SAMPLED") expect(spans).toHaveLength(0);
        else {
          expect(spans.map((span) => span.name).sort()).toEqual(
            sampling === undefined
              ? ["DurableExecutionRoot", "Invocation", "Workflow", "call"]
              : ["Invocation", "Workflow", "call"],
          );
          const span = spans.find((span) => span.name === "call")!;
          expect(parsed?.traceId).toBe(span.spanContext().traceId);
          expect(parsed?.parentSpanId).toBe(span.spanContext().spanId);
          expect(span.spanContext().traceFlags & 1).toBe(1);
        }
        started.mockRestore();
      },
    );

    it.each(["SAMPLED", "NOT_SAMPLED", undefined] as const)(
      "carries each actual invoke span identity through a batched public START (%s)",
      async (sampling) => {
        const plugin = make(sampling);
        const requests: CheckpointDurableExecutionRequest[] = [];
        const operations: WireOperation[] = [
          {
            Id: "execution",
            Type: OperationType.EXECUTION,
            Status: OperationStatus.STARTED,
            StartTimestamp: info.executionStartTimestamp,
            ExecutionDetails: { InputPayload: "{}" },
          },
        ];
        const client: DurableExecutionClient = {
          async getExecutionState() {
            return { Operations: operations };
          },
          async checkpoint(request) {
            requests.push(JSON.parse(JSON.stringify(request)));
            return {
              CheckpointToken: "next",
              NewExecutionState: {
                Operations: (request.Updates ?? []).map((update) => ({
                  Id: update.Id,
                  Type: update.Type,
                  Name: update.Name,
                  ParentId: update.ParentId,
                  SubType: update.SubType,
                  Status: OperationStatus.SUCCEEDED,
                  StartTimestamp: info.executionStartTimestamp,
                  EndTimestamp: new Date("2026-01-01T00:00:01Z"),
                  ChainedInvokeDetails: { Result: update.Payload },
                })),
              },
            };
          },
        };
        const lambdaContext: Context = {
          awsRequestId: "req",
          getRemainingTimeInMillis: () => 0,
          callbackWaitsForEmptyEventLoop: false,
          functionName: "parent",
          functionVersion: "1",
          invokedFunctionArn: "parent:1",
          memoryLimitInMB: "128",
          logGroupName: "group",
          logStreamName: "stream",
          done() {},
          fail() {},
          succeed() {},
        };
        const handler = withDurableExecution(
          async (_, ctx) => {
            const first = ctx.invoke(
              "first",
              "first:1",
              { item: 1 },
              { tenantId: "tenant" },
            );
            const second = ctx.invoke("second", "second:1", { item: 2 });
            return [await first, await second];
          },
          { plugins: [plugin] },
        );
        const result = await handler(
          new DurableExecutionInvocationInputWithClient(
            {
              DurableExecutionArn: info.executionArn,
              CheckpointToken: "token",
              InitialExecutionState: { Operations: operations },
            },
            client,
          ),
          lambdaContext,
        );
        expect(result).toMatchObject({
          Status: "SUCCEEDED",
          Result: '[{"item":1},{"item":2}]',
        });
        expect(requests).toHaveLength(1);
        const updates = requests[0].Updates!;
        expect(updates).toHaveLength(2);
        const spans = exporter.getFinishedSpans();
        const headers = updates.map((update) =>
          parseXRayTraceHeader(update.ChainedInvokeOptions?.XAmznTraceId),
        );
        expect(headers[0]?.parentSpanId).not.toBe(headers[1]?.parentSpanId);
        for (const [i, update] of updates.entries()) {
          const parsed = headers[i];
          expect(parsed?.parentSpanId).toBe(
            deriveSpanIdFromOperationId(update.Id!, info.executionArn),
          );
          expect(parsed?.sampling).toBe(
            sampling === "NOT_SAMPLED" ? "NOT_SAMPLED" : "SAMPLED",
          );
          if (sampling) expect(parsed?.traceId).toBe(upstreamTrace);
          expect(update.Payload).toBe(JSON.stringify({ item: i + 1 }));
          expect(update.ChainedInvokeOptions?.FunctionName).toBe(
            `${i === 0 ? "first" : "second"}:1`,
          );
          expect(update.ChainedInvokeOptions?.TenantId).toBe(
            i === 0 ? "tenant" : undefined,
          );
          if (sampling !== "NOT_SAMPLED") {
            const span = spans.find((span) => span.name === update.Name)!;
            expect(parsed?.parentSpanId).toBe(span.spanContext().spanId);
            expect(parsed?.traceId).toBe(span.spanContext().traceId);
          }
        }
        expect(spans.map((span) => span.name).sort()).toEqual(
          sampling === "NOT_SAMPLED"
            ? []
            : sampling === undefined
              ? [
                  "DurableExecutionRoot",
                  "Invocation",
                  "Workflow",
                  "first",
                  "second",
                ]
              : ["Invocation", "Workflow", "first", "second"],
        );
      },
    );

    it("does not produce metadata when invocation setup failed", async () => {
      exporter = new InMemorySpanExporter();
      const plugin = new Plugin({
        contextExtractor: () => {
          throw new Error("extractor failed");
        },
        tracerProviderFactory: (ids) =>
          (provider = new NodeTracerProvider({
            idGenerator: ids(),
            spanProcessors: [new SimpleSpanProcessor(exporter)],
          })),
      });
      await expect(plugin.onInvocationStart(info)).rejects.toThrow(
        "extractor failed",
      );
      expect(plugin.providePropagationMetadata(input)).toBeUndefined();
      expect(exporter.getFinishedSpans()).toHaveLength(0);
    });

    it("rejects another execution and clears ownership across invocation boundaries", async () => {
      const plugin = make("SAMPLED");
      await plugin.onInvocationStart(info);
      expect(
        plugin.providePropagationMetadata({ ...input, executionArn: "other" }),
      ).toBeUndefined();
      const first = plugin.providePropagationMetadata(input);
      await plugin.onInvocationEnd({ ...info, status: "PENDING" });
      expect(plugin.providePropagationMetadata(input)).toBeUndefined();
      await plugin.onInvocationStart({
        ...info,
        isFirstInvocation: false,
        requestId: "resume",
      });
      expect(plugin.providePropagationMetadata(input)).toEqual(first);
      await plugin.onInvocationEnd({ ...info, status: "PENDING" });
      await plugin.onInvocationStart({ ...info, executionArn: "other" });
      expect(plugin.providePropagationMetadata(input)).toBeUndefined();
      expect(
        plugin.providePropagationMetadata({ ...input, executionArn: "other" })
          ?.xAmznTraceId,
      ).not.toBe(first?.xAmznTraceId);
      await plugin.onInvocationEnd({
        ...info,
        executionArn: "other",
        status: "SUCCEEDED",
      });
    });
  },
);
