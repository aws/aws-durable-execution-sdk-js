import {
  withDurableExecution,
  type OperationInfo,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { context, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { ExecutionOtelPlugin } from "../execution-plugin";

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
};

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

it("keeps a parent recorded despite a suppressed checkpoint, without leaking that decision into reuse", async () => {
  const exporter = new InMemorySpanExporter();
  let provider!: NodeTracerProvider;
  const plugin = new ExecutionOtelPlugin({
    contextExtractor: () => undefined,
    tracerProviderFactory: (ids) =>
      (provider = new NodeTracerProvider({
        idGenerator: ids(),
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      })),
  });
  const observations: Array<{
    parentId: string;
    traceId: string;
    actualParent: string | undefined;
    expectedParent: string;
  }> = [];
  try {
    // Reuse the same plugin with the same operation sequence. The second run's
    // unfinished parent must still use the existing Workflow fallback.
    for (const finishParent of [true, false]) {
      const ready = gate();
      const releaseParent = gate();
      const parentEnded = gate();
      const rootLive = gate();
      const releaseRoot = gate();
      let childWork: PromiseLike<unknown> | undefined;
      let snapshot: Record<string, OperationInfo> | undefined;
      let callback: OperationInfo | undefined;
      const body = jest.fn(async () => {
        rootLive.open();
        await releaseRoot.opened;
        return "saved";
      });
      const before = exporter.getFinishedSpans().length;
      const handler = withDurableExecution(
        async (_, ctx) => {
          await ctx.runInChildContext("outer", async (outer) => {
            childWork = outer.runInChildContext("parent", async (parent) => {
              await parent.createCallback("external");
              ready.open();
              // A test scheduling gate: no checkpoint, state, timestamp or hook
              // is injected. The real child returns after its enclosing context.
              await releaseParent.opened;
              return "parent result";
            });
            await ready.opened;
            return "outer result";
          });
          return ctx.step("keep-alive", body);
        },
        {
          pluginsConfig: { childOperationsDepth: 2 },
          plugins: [
            plugin,
            {
              async onOperationEnd(info) {
                if (info.name === "parent") parentEnded.open();
              },
              async onOperationChange(info) {
                const completed = Object.values(info.updatedOperations).find(
                  (op) => op.name === "external" && op.status === "SUCCEEDED",
                );
                if (completed) {
                  callback = completed;
                  snapshot = info.operations;
                }
              },
            },
          ],
        },
      );
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });
      const execution = runner.run();
      try {
        await rootLive.opened;
        await runner
          .getOperation("outer")
          .waitForData(WaitingOperationStatus.COMPLETED);
        await runner
          .getOperation("parent")
          .waitForData(WaitingOperationStatus.STARTED);
        if (finishParent) {
          releaseParent.open();
          await parentEnded.opened;
          expect(
            exporter
              .getFinishedSpans()
              .slice(before)
              .filter((span) => span.name === "parent"),
          ).toHaveLength(1);
        }
        // Its terminal checkpoint is suppressed under the finished outer
        // context, even when the SDK has already exported the parent's span.
        expect(runner.getOperation("outer").getOperationData()?.Status).toBe(
          "SUCCEEDED",
        );
        expect(runner.getOperation("parent").getOperationData()?.Status).toBe(
          "STARTED",
        );
        const external = runner.getOperation("external");
        await external.waitForData(WaitingOperationStatus.STARTED);
        await external.sendCallbackSuccess("external result");
        releaseRoot.open();
        const result = await execution;
        expect(result.getStatus()).toBe("SUCCEEDED");
        expect(result.getResult()).toBe("saved");
        expect(body).toHaveBeenCalledTimes(1);
        expect(callback).toBeDefined();
        expect(snapshot?.[callback!.parentId!].status).toBe("STARTED");
        const ancestor = snapshot?.[snapshot[callback!.parentId!].parentId!];
        expect(ancestor?.status).toBe("SUCCEEDED");
        const spans = exporter.getFinishedSpans().slice(before);
        const completion = spans.filter(
          (span) =>
            span.name === "external" &&
            span.attributes["durable.operation.status"] === "SUCCEEDED",
        );
        const parents = spans.filter((span) => span.name === "parent");
        expect(completion).toHaveLength(1);
        expect(parents).toHaveLength(finishParent ? 1 : 0);
        const expectedParent = finishParent
          ? parents[0]
          : spans.find((span) => span.name === "Workflow")!;
        expect(expectedParent).toBeDefined();
        observations.push({
          parentId: callback!.parentId!,
          traceId: completion[0].spanContext().traceId,
          actualParent: completion[0].parentSpanContext?.spanId,
          expectedParent: expectedParent.spanContext().spanId,
        });
      } finally {
        releaseParent.open();
        releaseRoot.open();
        await Promise.resolve(childWork).catch(() => undefined);
        await execution.catch(() => undefined);
      }
    }
    expect(observations).toHaveLength(2);
    expect(observations[0].parentId).toBe(observations[1].parentId);
    expect(observations[0].traceId).not.toBe(observations[1].traceId);
    expect(
      observations.map((item) => item.actualParent === item.expectedParent),
    ).toEqual([true, true]);
  } finally {
    await provider.shutdown();
    trace.disable();
    context.disable();
  }
}, 30000);
