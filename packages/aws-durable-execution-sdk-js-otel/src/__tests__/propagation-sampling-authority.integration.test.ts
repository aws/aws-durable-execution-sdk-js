import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { context, trace } from "@opentelemetry/api";
import type { Tracer } from "@opentelemetry/api";
import {
  AlwaysOnSampler,
  InMemorySpanExporter,
  NodeTracerProvider,
  SamplingDecision,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import type { Sampler } from "@opentelemetry/sdk-trace-node";
import {
  DurableExecutionInvocationInputWithClient,
  OperationStatus,
  OperationType,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import type {
  CheckpointDurableExecutionRequest,
  DurableExecutionClient,
  WireOperation,
} from "@aws/durable-execution-sdk-js";
import type { Context } from "aws-lambda";
import { ExecutionOtelPlugin } from "../execution-plugin";
import { InvocationOtelPlugin } from "../invocation-plugin";
import { parseXRayTraceHeader } from "../context-extractors";

const executionArn =
  "arn:aws:lambda:us-west-2:123456789012:function:parent:1/durable-execution/authority/1";
const started = new Date("2026-01-01T00:00:00Z");
const lambdaContext: Context = {
  awsRequestId: "request",
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

const variants = [
  { name: "managed invocation-drop policy", mode: "managed", dropCall: false },
  {
    name: "replacement operation-drop policy",
    mode: "replacement",
    dropCall: true,
  },
  { name: "opaque operation-drop policy", mode: "opaque", dropCall: true },
  { name: "opaque invocation-drop control", mode: "opaque", dropCall: false },
] as const;

describe.each([ExecutionOtelPlugin, InvocationOtelPlugin])(
  "%p public invoke sampling authority",
  (Plugin) => {
    let provider: NodeTracerProvider;
    beforeEach(() => {
      context.setGlobalContextManager(
        new AsyncLocalStorageContextManager().enable(),
      );
    });
    afterEach(async () => {
      await provider?.shutdown();
      context.disable();
      trace.disable();
    });

    it.each(variants)("$name", async ({ mode, dropCall }) => {
      const exporter = new InMemorySpanExporter();
      const queries: string[] = [];
      const policy: Sampler = {
        shouldSample(_context, _traceId, spanName) {
          queries.push(spanName);
          return {
            decision:
              spanName === "Invocation" || (dropCall && spanName === "call")
                ? SamplingDecision.NOT_RECORD
                : SamplingDecision.RECORD_AND_SAMPLED,
          };
        },
        toString: () => "NameSelectiveSampler",
      };
      let nativeTracer!: Tracer;
      let starts!: jest.SpyInstance;
      const plugin = new Plugin({
        contextExtractor: () => undefined,
        tracerProviderFactory: (ids) => {
          provider = new NodeTracerProvider({
            idGenerator: ids(),
            sampler: mode === "replacement" ? new AlwaysOnSampler() : policy,
            spanProcessors: [new SimpleSpanProcessor(exporter)],
          });
          nativeTracer = provider.getTracer("aws-durable-execution-sdk-js");
          // Calls through to the real SDK tracer. No probe or fabricated Span.
          starts = jest.spyOn(nativeTracer, "startSpan");
          if (mode !== "opaque") return provider;
          return {
            getTracer: () => ({
              startSpan: nativeTracer.startSpan.bind(nativeTracer),
              startActiveSpan: nativeTracer.startActiveSpan.bind(nativeTracer),
            }),
            forceFlush: () => provider.forceFlush(),
          };
        },
      });
      if (mode === "replacement") {
        // The real tracer's sampler is replaced after plugin construction;
        // this is the same writable field used by the production bridge.
        expect(Reflect.set(nativeTracer, "_sampler", policy)).toBe(true);
      }
      const requests: CheckpointDurableExecutionRequest[] = [];
      const operations: WireOperation[] = [
        {
          Id: "execution",
          Type: OperationType.EXECUTION,
          Status: OperationStatus.STARTED,
          StartTimestamp: started,
          ExecutionDetails: { InputPayload: "{}" },
        },
      ];
      // Only the service boundary is simulated. Public invoke, optional hook
      // dispatch, operation creation and actual SDK sampler decisions execute.
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
                SubType: update.SubType,
                Name: update.Name,
                ParentId: update.ParentId,
                Status: OperationStatus.SUCCEEDED,
                StartTimestamp: started,
                EndTimestamp: new Date("2026-01-01T00:00:01Z"),
                ChainedInvokeDetails: { Result: update.Payload },
              })),
            },
          };
        },
      };
      const handler = withDurableExecution(
        async (_event, ctx) =>
          ctx.invoke("call", "callee:1", { value: "kept" }),
        { plugins: [plugin] },
      );
      const result = await handler(
        new DurableExecutionInvocationInputWithClient(
          {
            DurableExecutionArn: executionArn,
            CheckpointToken: "token",
            InitialExecutionState: { Operations: operations },
          },
          client,
        ),
        lambdaContext,
      );
      expect(result).toMatchObject({
        Status: "SUCCEEDED",
        Result: '{"value":"kept"}',
      });
      const update = requests
        .flatMap((request) => request.Updates ?? [])
        .find((operation) => operation.Type === OperationType.CHAINED_INVOKE)!;
      expect(update.ChainedInvokeOptions?.FunctionName).toBe("callee:1");
      const header = parseXRayTraceHeader(
        update.ChainedInvokeOptions?.XAmznTraceId,
      );
      const callIndex = starts.mock.calls.findIndex(
        (call) => call[0] === "call",
      );
      expect(callIndex).toBeGreaterThanOrEqual(0);
      const operation = starts.mock.results[callIndex].value.spanContext();
      const invocationIndex = starts.mock.calls.findIndex(
        (call) => call[0] === "Invocation",
      );
      const invocation =
        starts.mock.results[invocationIndex].value.spanContext();
      expect(operation.traceFlags & 1).toBe(dropCall ? 0 : 1);
      expect(invocation.traceFlags & 1).toBe(mode === "managed" ? 1 : 0);
      if (mode === "managed") {
        expect(header).toMatchObject({
          traceId: operation.traceId,
          parentSpanId: operation.spanId,
          sampling: "SAMPLED",
        });
        expect(queries).toEqual(["Workflow"]);
      } else {
        expect(update.ChainedInvokeOptions).toEqual({
          FunctionName: "callee:1",
        });
        expect(header).toBeUndefined();
        expect(queries).toEqual(
          mode === "opaque"
            ? ["Invocation", "call", "DurableExecutionRoot", "Workflow"]
            : [
                "Workflow",
                "Invocation",
                "DurableExecutionRoot",
                "call",
                "Workflow",
              ],
        );
      }
      expect(starts.mock.calls.map((call) => call[0])).toEqual(
        mode === "opaque"
          ? ["Invocation", "call", "DurableExecutionRoot", "Workflow"]
          : ["Invocation", "DurableExecutionRoot", "call", "Workflow"],
      );
      starts.mockRestore();
    });
  },
);
