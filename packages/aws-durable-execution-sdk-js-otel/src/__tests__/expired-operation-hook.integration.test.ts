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
const input = () => ({
  DurableExecutionArn:
    "arn:aws:lambda:us-east-1:123456789012:function:test:$LATEST/durable-execution/replay/id",
  CheckpointToken: "token-0",
  InitialExecutionState: {
    Operations: [
      {
        Id: "execution",
        Type: "EXECUTION" as const,
        Status: "STARTED" as const,
        StartTimestamp: new Date(),
        ExecutionDetails: { InputPayload: "{}" },
      },
    ],
  },
});

describe.each([
  ["execution", ExecutionOtelPlugin],
  ["invocation", InvocationOtelPlugin],
] as const)("%s view expired operation hook", (_view, Plugin) => {
  it("does not dispatch an old attempt after a new invocation starts the same step", async () => {
    trace.disable();
    context.disable();
    propagation.disable();
    const firstStartEntered = gate(),
      releaseFirstStart = gate();
    const secondBodyEntered = gate(),
      releaseSecondBody = gate();
    const exporter = new InMemorySpanExporter();
    const attempts: Span[] = [];
    const observer: SpanProcessor = {
      onStart(span) {
        if (span.name === "same-step attempt 1") attempts.push(span);
      },
      onEnd() {},
      async forceFlush() {},
      async shutdown() {},
    };
    let provider!: NodeTracerProvider;
    const plugin = new Plugin({
      contextExtractor: () => undefined,
      tracerProviderFactory: (ids) =>
        (provider = new NodeTracerProvider({
          idGenerator: ids(),
          spanProcessors: [observer, new SimpleSpanProcessor(exporter)],
        })),
    });
    const starts = jest.fn(async () => {
      if (starts.mock.calls.length === 1) {
        firstStartEntered.open();
        await releaseFirstStart.opened;
      }
    });
    const attemptStart = jest.spyOn(plugin, "onOperationAttemptStart");
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
    const body = jest.fn(async () => {
      secondBodyEntered.open();
      await releaseSecondBody.opened;
      return "second result";
    });
    const handler = withDurableExecution(
      async (_, ctx) => ctx.step("same-step", body),
      {
        durableExecutionClient: client,
        plugins: [plugin, { onOperationStart: starts }],
      },
    );
    const first = handler(input(), {
      awsRequestId: "first",
      getRemainingTimeInMillis: () => 1000,
    } as Context).catch((error: Error) => error);
    let second: ReturnType<typeof handler> | undefined;
    try {
      await firstStartEntered.opened;
      expect(await first).toBeInstanceOf(Error);
      expect(body).not.toHaveBeenCalled();
      second = handler(input(), {
        awsRequestId: "second",
        getRemainingTimeInMillis: () => 30000,
      } as Context);
      await secondBodyEntered.opened;
      expect(attempts).toHaveLength(1);
      releaseFirstStart.open();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(attemptStart).toHaveBeenCalledTimes(1);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].isRecording()).toBe(true);
      releaseSecondBody.open();
      expect(await second).toEqual({
        Status: "SUCCEEDED",
        Result: '"second result"',
      });
      expect(body).toHaveBeenCalledTimes(1);
      const finished = exporter
        .getFinishedSpans()
        .filter((span) => span.name === "same-step attempt 1");
      expect(finished).toHaveLength(1);
      expect(finished[0].spanContext()).toEqual(attempts[0].spanContext());
      expect(finished[0].attributes["durable.attempt.outcome"]).toBe(
        "SUCCEEDED",
      );
    } finally {
      releaseFirstStart.open();
      releaseSecondBody.open();
      await first;
      await second?.catch(() => undefined);
      await provider.shutdown();
      trace.disable();
      context.disable();
      propagation.disable();
    }
  }, 15000);
});
