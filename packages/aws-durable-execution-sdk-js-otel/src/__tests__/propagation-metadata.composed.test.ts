import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import type {
  InvocationInfo,
  PropagationInput,
} from "@aws/durable-execution-sdk-js";
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
          expect(spans).toHaveLength(3);
          const span = spans.find((span) => span.name === "call")!;
          expect(parsed?.traceId).toBe(span.spanContext().traceId);
          expect(parsed?.parentSpanId).toBe(span.spanContext().spanId);
          expect(span.spanContext().traceFlags & 1).toBe(1);
        }
        started.mockRestore();
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
