import {
  withDurableExecution,
  InvocationStatus,
  type OperationEndInfo,
  type OperationChangeInfo,
  type InvocationInfo,
} from "@aws/durable-execution-sdk-js";
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
import { ExecutionOtelPlugin } from "../execution-plugin";
import { InvocationOtelPlugin } from "../invocation-plugin";

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
};

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe.each([ExecutionOtelPlugin, InvocationOtelPlugin])(
  "%p errorless invoke metadata",
  (Plugin) => {
    it.each(["live", "replay", "deferred"] as const)(
      "keeps caller failure and metadata consistent through %s delivery and another replay",
      async (delivery) => {
        const exporter = new InMemorySpanExporter();
        let provider!: NodeTracerProvider;
        const inStep = gate(),
          releaseStep = gate(),
          releaseCallee = gate(),
          firstPending = gate();
        const ends: OperationEndInfo[] = [];
        const starts: InvocationInfo[] = [];
        const endInvocations: number[] = [];
        const changes: OperationChangeInfo[] = [];
        const failures: Array<{ name: string; message: string }> = [];
        const step = jest.fn(async () => {
          inStep.open();
          await releaseStep.opened;
          return "saved";
        });
        let calleeCalls = 0;
        const plugin = new Plugin({
          contextExtractor: () => undefined,
          tracerProviderFactory: (ids) =>
            (provider = new NodeTracerProvider({
              idGenerator: ids(),
              spanProcessors: [new SimpleSpanProcessor(exporter)],
            })),
        });
        const handler = withDurableExecution(
          async (_, ctx) => {
            const pending = ctx.invoke("failed-invoke", "errorless:1", {});
            await ctx.step("saved", step);
            if (delivery !== "live")
              await ctx.wait("intervening", { seconds: 1 });
            try {
              await pending;
            } catch (error) {
              failures.push({
                name: (error as Error).name,
                message: (error as Error).message,
              });
            }
            const [later] = await ctx.createCallback("after-failure");
            await later;
            return "failure caught";
          },
          {
            plugins: [
              plugin,
              {
                async onInvocationStart(info) {
                  starts.push(info);
                },
                async onOperationEnd(info) {
                  if (info.type === "CHAINED_INVOKE") {
                    ends.push(info);
                    endInvocations.push(starts.length);
                  }
                },
                async onOperationChange(info) {
                  changes.push(info);
                },
              },
            ],
          },
        );
        const runner = new LocalDurableTestRunner({
          handlerFunction: async (event, context) => {
            const result = await handler(event, context);
            if (result.Status === InvocationStatus.PENDING) firstPending.open();
            return result;
          },
        });
        // A legal durable Lambda failure response with no backend error details.
        // The public invoke path, checkpoints and metadata conversion remain real.
        runner.registerDurableFunction("errorless:1", async () => {
          calleeCalls++;
          await releaseCallee.opened;
          return { Status: InvocationStatus.FAILED, Error: {} };
        });
        try {
          const execution = runner.run();
          await inStep.opened;
          const invoked = runner.getOperation("failed-invoke");
          await invoked.waitForData(WaitingOperationStatus.STARTED);
          if (delivery === "replay") {
            releaseStep.open();
            await runner.pauseExecution();
            await firstPending.opened;
          }
          releaseCallee.open();
          await invoked.waitForData(WaitingOperationStatus.COMPLETED);
          releaseStep.open();
          if (delivery === "replay") await runner.resumeExecution();
          const later = runner.getOperation("after-failure");
          await later.waitForData(WaitingOperationStatus.STARTED);
          await runner.pauseExecution();
          await later.sendCallbackSuccess("continue");
          await runner.resumeExecution();
          const result = await execution;
          expect(result.getResult()).toBe("failure caught");
          expect(calleeCalls).toBe(1);
          expect(step).toHaveBeenCalledTimes(1);
          expect(failures.length).toBeGreaterThanOrEqual(2);
          expect(
            failures.every(
              (error) =>
                error.name === "InvokeError" &&
                error.message === "Invoke failed",
            ),
          ).toBe(true);
          expect(ends.length).toBeGreaterThanOrEqual(2);
          // Fresh startup updates are not replay even though phase 1 consumes
          // their stored outcome. A subsequent invocation must replay it.
          expect(ends[0].isReplay).toBe(delivery === "deferred");
          expect(ends.some((info) => info.isReplay)).toBe(true);
          if (delivery === "live") expect(endInvocations[0]).toBe(1);
          else expect(endInvocations[0]).toBeGreaterThan(1);
          const startupFailures = starts.flatMap((info) =>
            Object.values(info.updatedOperations).filter(
              (operation) =>
                operation.type === "CHAINED_INVOKE" &&
                operation.status === "FAILED",
            ),
          );
          expect(startupFailures).toHaveLength(delivery === "replay" ? 1 : 0);
          expect(
            ends.every(
              (info) => info.status === "FAILED" && info.error === undefined,
            ),
          ).toBe(true);
          const update = changes
            .flatMap((info) => Object.values(info.updatedOperations))
            .find(
              (info) =>
                info.type === "CHAINED_INVOKE" && info.status === "FAILED",
            );
          if (delivery !== "replay") expect(update?.error).toBeUndefined();
          const terminal = exporter
            .getFinishedSpans()
            .filter(
              (span) =>
                span.attributes["durable.operation.type"] ===
                  "CHAINED_INVOKE" &&
                span.attributes["durable.operation.status"] === "FAILED",
            );
          expect(terminal).toHaveLength(1);
          expect(terminal[0].status.code).toBe(SpanStatusCode.UNSET);
          expect(terminal[0].events).toHaveLength(0);
        } finally {
          releaseStep.open();
          releaseCallee.open();
          await provider.shutdown();
          trace.disable();
          context.disable();
        }
      },
      30000,
    );
  },
);
