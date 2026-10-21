import {
  withDurableExecution,
  type DurableExecutionClient,
} from "@aws/durable-execution-sdk-js";
import type { Context } from "aws-lambda";
import {
  context,
  propagation,
  trace,
  SpanStatusCode,
  type Span,
} from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type SpanProcessor,
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
const input = (name: string) => ({
  DurableExecutionArn: `arn:aws:lambda:us-east-1:123456789012:function:test:$LATEST/durable-execution/${name}/id`,
  CheckpointToken: "token-0",
  InitialExecutionState: {
    Operations: [
      {
        Id: "execution",
        Type: "EXECUTION" as const,
        Status: "STARTED" as const,
        StartTimestamp: new Date(),
        ExecutionDetails: { InputPayload: JSON.stringify({ name }) },
      },
    ],
  },
});

describe.each([
  ["execution", createExecutionOtelPluginFactory],
  ["invocation", createInvocationOtelPluginFactory],
] as const)("%s view deadline instrumentation", (_view, Plugin) => {
  it.each([false, true])(
    "ends only the expired invocation's owned spans (next already started=%s)",
    async (overlap) => {
      trace.disable();
      context.disable();
      propagation.disable();
      const entered = [gate(), gate()],
        release = [gate(), gate()];
      const releaseFlush = gate();
      const exporter = new InMemorySpanExporter();
      const attempts: Span[] = [],
        invocations: Span[] = [];
      let flushCount = 0;
      const observer: SpanProcessor = {
        onStart(span) {
          if (span.name === "work attempt 1") attempts.push(span);
          if (span.name === "Invocation") invocations.push(span);
        },
        onEnd() {},
        async forceFlush() {
          if (++flushCount === 1) await releaseFlush.opened;
        },
        async shutdown() {},
      };
      let provider!: NodeTracerProvider;
      const plugin = Plugin({
        contextExtractor: () => undefined,
        flushTimeoutMillis: 5000,
        tracerProviderFactory: (ids) =>
          (provider = new NodeTracerProvider({
            idGenerator: ids(),
            spanProcessors: [observer, new SimpleSpanProcessor(exporter)],
          })),
      });
      const end: jest.SpyInstance[] = [];
      const createPlugin = plugin.createPlugin.bind(plugin);
      jest.spyOn(plugin, "createPlugin").mockImplementation((info) => {
        const instance = createPlugin(info);
        end.push(jest.spyOn(instance, "onInvocationEnd"));
        return instance;
      });
      const finalized = jest.fn();
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
              EndTimestamp:
                update.Action === "SUCCEED" ? new Date() : undefined,
              Status: update.Action === "SUCCEED" ? "SUCCEEDED" : "STARTED",
              StepDetails:
                update.Type === "STEP" ? { Result: update.Payload } : undefined,
            })),
          },
        }),
      };
      const handler = withDurableExecution(
        async (event: { name: string }, ctx) => {
          const index = event.name === "first" ? 0 : 1;
          try {
            return await ctx.step("work", async () => {
              entered[index].open();
              await release[index].opened;
              return event.name;
            });
          } finally {
            finalized(event.name);
          }
        },
        { durableExecutionClient: client, plugins: [plugin] },
      );
      const first = handler(input("first"), {
        awsRequestId: "first",
        getRemainingTimeInMillis: () => 1000,
      } as Context).catch((error: Error) => error);
      let second: ReturnType<typeof handler> | undefined;
      const startSecond = async () => {
        second = handler(input("second"), {
          awsRequestId: "second",
          getRemainingTimeInMillis: () => 30000,
        } as Context);
        await entered[1].opened;
      };
      try {
        await entered[0].opened;
        expect(attempts[0].isRecording()).toBe(true);
        if (overlap) await startSecond();
        expect(await first).toEqual(
          expect.objectContaining({
            message: expect.stringContaining("invocation deadline"),
          }),
        );
        expect(finalized).not.toHaveBeenCalled();
        {
          expect(end[0]).toHaveBeenCalledTimes(1);
          expect(end[0]).toHaveBeenCalledWith(
            expect.objectContaining({ requestId: "first", status: "RETRYING" }),
          );
          expect(attempts[0].isRecording()).toBe(false);
          expect(invocations[0].isRecording()).toBe(false);
          const firstSpans = exporter
            .getFinishedSpans()
            .filter(
              (span) =>
                span.attributes["durable.execution.arn"] ===
                input("first").DurableExecutionArn,
            );
          const invocation = firstSpans.find(
            (span) => span.name === "Invocation",
          )!;
          expect(invocation.attributes["durable.invocation.status"]).toBe(
            "RETRYING",
          );
          expect(invocation.status.code).toBe(SpanStatusCode.UNSET);
          expect(
            firstSpans.find((span) => span.name === "work attempt 1")
              ?.attributes["durable.attempt.outcome"],
          ).toBeUndefined();
          expect(
            firstSpans.filter((span) => span.name === "Workflow"),
          ).toHaveLength(0);
          expect(flushCount).toBe(1); // Caller returned while this flush is still held.
          if (!overlap) await startSecond();
        }
        expect(attempts[1].isRecording()).toBe(true);
        expect(invocations[1].isRecording()).toBe(true);
        releaseFlush.open();
        await end[0].mock.results[0].value;
        expect(attempts[1].isRecording()).toBe(true);
        release[0].open();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(finalized).not.toHaveBeenCalled();
        release[1].open();
        expect(await second).toEqual({
          Status: "SUCCEEDED",
          Result: '"second"',
        });
        expect(finalized.mock.calls).toEqual([["second"]]);
        expect(
          end.flatMap((spy) =>
            spy.mock.calls.map(([info]) => [info.requestId, info.status]),
          ),
        ).toEqual([
          ["first", "RETRYING"],
          ["second", "SUCCEEDED"],
        ]);
      } finally {
        releaseFlush.open();
        release[0].open();
        release[1].open();
        await first;
        await second?.catch(() => undefined);
        await provider.shutdown();
        trace.disable();
        context.disable();
        propagation.disable();
      }
    },
    15000,
  );
});
