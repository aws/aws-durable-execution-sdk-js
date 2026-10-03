import {
  withDurableExecution,
  type InvocationInfo,
  type OperationEndInfo,
  type OperationInfo,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import {
  context,
  trace,
  SpanStatusCode,
  type SpanContext,
} from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { ExecutionOtelPlugin } from "../execution-plugin";
import { InvocationOtelPlugin } from "../invocation-plugin";
import { deriveSpanIdFromOperationId } from "../deterministic-id-generator";

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
};
beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe.each([
  ["execution", ExecutionOtelPlugin],
  ["invocation", InvocationOtelPlugin],
] as const)("%s view pending replay traversal", (view, Plugin) => {
  it.each([false, true])(
    "exports the completion under the active child before it closes (failure=%s)",
    async (fails) => {
      const exporter = new InMemorySpanExporter();
      let provider!: NodeTracerProvider;
      const plugin = new Plugin({
        contextExtractor: () => undefined,
        tracerProviderFactory(createIdGenerator) {
          provider = new NodeTracerProvider({
            idGenerator: createIdGenerator(),
            spanProcessors: [new SimpleSpanProcessor(exporter)],
          });
          provider.register();
          return provider;
        },
      });
      // A public asynchronous step deserializer models a delayed external-storage
      // read during replay. Gates only control I/O scheduling; operation sequence,
      // names, stored values and workflow outcomes are identical on every run.
      let delayStoredRead = false;
      const storedReadEntered = gate();
      const releaseStoredRead = gate();
      const checkpointBodyEntered = gate();
      const releaseCheckpointBody = gate();
      const updateReceived = gate();
      const starts: InvocationInfo[] = [];
      const ends: OperationEndInfo[] = [];
      const updates: OperationInfo[] = [];
      const parentsAtRead: SpanContext[] = [];
      const exportsAtChildEnd: number[] = [];
      const savedBody = jest.fn(async () => "saved");
      const checkpointBody = jest.fn(async () => {
        checkpointBodyEntered.open();
        await releaseCheckpointBody.opened;
        return "checkpointed";
      });
      const terminalSpans = () =>
        exporter
          .getFinishedSpans()
          .filter(
            (span) =>
              span.name === "external" &&
              span.attributes["durable.operation.status"] ===
                (fails ? "FAILED" : "SUCCEEDED"),
          );
      const handler = withDurableExecution(
        async (_, ctx) => {
          const branches = await ctx.parallel("branches", [
            {
              name: "poller",
              func: async (child) => {
                const [resume] = await child.createCallback("resume-poller");
                await resume;
                return child.step("fetch-update", checkpointBody);
              },
            },
            {
              name: "scope",
              func: async (child) => {
                const saved = await child.step("saved", savedBody, {
                  serdes: {
                    serialize: async (value) => JSON.stringify(value),
                    deserialize: async (value) => {
                      if (delayStoredRead) {
                        storedReadEntered.open();
                        await releaseStoredRead.opened;
                      }
                      return JSON.parse(value!);
                    },
                  },
                });
                const active = trace.getSpanContext(context.active());
                if (active) parentsAtRead.push(active);
                const [external] =
                  await child.createCallback<string>("external");
                let outcome: string;
                try {
                  outcome = await external;
                } catch (error) {
                  outcome = (error as Error).message;
                }
                return `${saved}:${outcome}`;
              },
            },
          ]);
          branches.throwIfError();
          const [later] = await ctx.createCallback("later");
          await later;
          return branches.getResults();
        },
        {
          plugins: [
            plugin,
            {
              async onInvocationStart(info) {
                starts.push(info);
              },
              async onOperationChange(info) {
                for (const operation of Object.values(info.updatedOperations)) {
                  if (
                    operation.name === "external" &&
                    operation.status === (fails ? "FAILED" : "SUCCEEDED")
                  ) {
                    updates.push(operation);
                    updateReceived.open();
                  }
                }
              },
              async onOperationEnd(info) {
                if (info.name === "external") ends.push(info);
                if (info.name === "scope")
                  exportsAtChildEnd.push(terminalSpans().length);
              },
            },
          ],
        },
      );
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });
      try {
        const execution = runner.run();
        const external = runner.getOperation("external");
        const resume = runner.getOperation("resume-poller");
        await external.waitForData(WaitingOperationStatus.STARTED);
        await resume.waitForData(WaitingOperationStatus.STARTED);
        await runner.pauseExecution();
        delayStoredRead = true;
        await resume.sendCallbackSuccess("resume");
        await runner.resumeExecution();
        await storedReadEntered.opened;
        await checkpointBodyEntered.opened;
        if (fails)
          await external.sendCallbackFailure({
            ErrorType: "ExternalError",
            ErrorMessage: "external failure",
          });
        else await external.sendCallbackSuccess("external result");
        releaseCheckpointBody.open();
        await updateReceived.opened;
        releaseStoredRead.open();
        const later = runner.getOperation("later");
        await later.waitForData(WaitingOperationStatus.STARTED);
        await runner.pauseExecution();
        await later.sendCallbackSuccess("continue");
        await runner.resumeExecution();
        const result = await execution;
        expect(result.getStatus()).toBe("SUCCEEDED");
        expect(result.getResult()).toEqual([
          "checkpointed",
          `saved:${fails ? "external failure" : "external result"}`,
        ]);
        expect(savedBody).toHaveBeenCalledTimes(1);
        expect(checkpointBody).toHaveBeenCalledTimes(1);
        expect(updates).toHaveLength(1);
        expect(ends).toHaveLength(1);
        expect(ends[0].isReplay).toBe(true);
        expect(
          starts.every((start) => !start.updatedOperations[ends[0].id]),
        ).toBe(true);
        expect(parentsAtRead).toHaveLength(2);
        expect(terminalSpans()).toHaveLength(1);
        const span = terminalSpans()[0];
        expect(span.parentSpanContext?.spanId).toBe(parentsAtRead[1].spanId);
        expect(span.spanContext().traceId).toBe(parentsAtRead[1].traceId);
        expect(span.status.code).toBe(
          fails ? SpanStatusCode.ERROR : SpanStatusCode.OK,
        );
        expect(exportsAtChildEnd).toEqual([1]);
        if (view === "invocation") {
          expect(span.links.map((link) => link.context.spanId)).toContain(
            deriveSpanIdFromOperationId(ends[0].id, starts[0].executionArn),
          );
        }
        if (fails)
          expect(span.events[0].attributes?.["exception.message"]).toBe(
            "external failure",
          );
      } finally {
        releaseStoredRead.open();
        releaseCheckpointBody.open();
        await provider.shutdown();
        trace.disable();
        context.disable();
      }
    },
    30000,
  );
});
