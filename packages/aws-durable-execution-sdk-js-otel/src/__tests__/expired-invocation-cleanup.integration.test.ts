import {
  withDurableExecution,
  type DurableExecutionClient,
} from "@aws/durable-execution-sdk-js";
import type { Context } from "aws-lambda";
import { context, propagation, trace, type Span } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type SpanProcessor,
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

const input = (name: string, first: boolean) => ({
  DurableExecutionArn: `arn:aws:lambda:us-east-1:123456789012:function:test:$LATEST/durable-execution/${name}/id`,
  CheckpointToken: "token-0",
  InitialExecutionState: {
    Operations: [
      {
        Id: "execution",
        Type: "EXECUTION" as const,
        Status: "STARTED" as const,
        StartTimestamp: new Date(),
        ExecutionDetails: { InputPayload: JSON.stringify({ first }) },
      },
    ],
  },
});

describe.each([
  ["execution", ExecutionOtelPlugin],
  ["invocation", InvocationOtelPlugin],
] as const)("%s view detached invocation cleanup", (_view, Plugin) => {
  it("does not end or discard the next invocation's spans when an expired flush resumes", async () => {
    trace.disable();
    context.disable();
    propagation.disable();
    const firstFlushEntered = gate(),
      releaseFirstFlush = gate();
    const secondBodyEntered = gate(),
      releaseSecondBody = gate();
    const exporter = new InMemorySpanExporter();
    const attempts: Span[] = [];
    let flushCount = 0;
    let provider!: NodeTracerProvider;
    const flushGate: SpanProcessor = {
      onStart(span) {
        if (span.name === "second-step attempt 1") attempts.push(span);
      },
      onEnd() {},
      async forceFlush() {
        if (++flushCount === 1) {
          firstFlushEntered.open();
          await releaseFirstFlush.opened;
        }
      },
      async shutdown() {},
    };
    const plugin = new Plugin({
      contextExtractor: () => undefined,
      flushTimeoutMillis: 5000,
      tracerProviderFactory: (ids) =>
        (provider = new NodeTracerProvider({
          idGenerator: ids(),
          spanProcessors: [flushGate, new SimpleSpanProcessor(exporter)],
        })),
    });
    const end = jest.spyOn(plugin, "onInvocationEnd");
    const client: DurableExecutionClient = {
      getExecutionState: async () => ({ Operations: [] }),
      checkpoint: async (request) => ({
        CheckpointToken: "live-token",
        NewExecutionState: {
          Operations: (request.Updates ?? []).map((update) => ({
            Id: update.Id,
            Type: update.Type,
            Name: update.Name,
            ParentId: update.ParentId,
            SubType: update.SubType,
            StartTimestamp: new Date(),
            EndTimestamp: update.Action === "SUCCEED" ? new Date() : undefined,
            Status: update.Action === "SUCCEED" ? "SUCCEEDED" : "STARTED",
            StepDetails:
              update.Type === "STEP" ? { Result: update.Payload } : undefined,
          })),
        },
      }),
    };
    const handler = withDurableExecution(
      async (event: { first: boolean }, ctx) => {
        if (event.first) return "x".repeat(6 * 1024 * 1024 + 100);
        return ctx.step("second-step", async () => {
          secondBodyEntered.open();
          await releaseSecondBody.opened;
          return "second result";
        });
      },
      { durableExecutionClient: client, plugins: [plugin] },
    );
    const first = handler(input("first", true), {
      awsRequestId: "request-first",
      getRemainingTimeInMillis: () => 1000,
    } as Context);
    let second: ReturnType<typeof handler> | undefined;
    try {
      await firstFlushEntered.opened;
      // The service acknowledged the oversized result, so the deadline returns
      // success while the already-entered plugin End is still suspended.
      expect(await first).toEqual({ Status: "SUCCEEDED", Result: "" });
      expect(end).toHaveBeenCalledTimes(1);
      second = handler(input("second", false), {
        awsRequestId: "request-second",
        getRemainingTimeInMillis: () => 30000,
      } as Context);
      await secondBodyEntered.opened;
      expect(attempts).toHaveLength(1);
      expect(attempts[0].isRecording()).toBe(true);
      releaseFirstFlush.open();
      await end.mock.results[0].value;
      expect(attempts[0].isRecording()).toBe(true);
      releaseSecondBody.open();
      expect(await second).toEqual({
        Status: "SUCCEEDED",
        Result: '"second result"',
      });
      const finished = exporter.getFinishedSpans();
      const secondAttempts = finished.filter(
        (span) => span.name === "second-step attempt 1",
      );
      expect(secondAttempts).toHaveLength(1);
      expect(secondAttempts[0].spanContext()).toEqual(
        attempts[0].spanContext(),
      );
      expect(secondAttempts[0].attributes["durable.attempt.outcome"]).toBe(
        "SUCCEEDED",
      );
      const secondOperations = finished.filter(
        (span) =>
          span.attributes["durable.operation.name"] === "second-step" &&
          span.attributes["durable.operation.status"] === "SUCCEEDED",
      );
      expect(secondOperations).toHaveLength(1);
      expect(secondOperations[0].spanContext().traceId).toBe(
        attempts[0].spanContext().traceId,
      );
      expect(secondOperations[0].attributes["durable.execution.arn"]).toBe(
        input("second", false).DurableExecutionArn,
      );
    } finally {
      releaseFirstFlush.open();
      releaseSecondBody.open();
      await first.catch(() => undefined);
      await second?.catch(() => undefined);
      await provider.shutdown();
      trace.disable();
      context.disable();
      propagation.disable();
    }
  }, 15000);
});
