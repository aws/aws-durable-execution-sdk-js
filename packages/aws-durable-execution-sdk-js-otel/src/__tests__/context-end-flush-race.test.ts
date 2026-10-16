import type {
  InvocationInfo,
  OperationInfo,
} from "@aws/durable-execution-sdk-js";
import { context, trace } from "@opentelemetry/api";
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

describe.each([
  ["execution", ExecutionOtelPlugin, 3],
  ["invocation", InvocationOtelPlugin, 2],
] as const)("%s context End / flush interleaving", (view, Plugin, turns) => {
  it("retains a live parent when flush completion interleaves with its End", async () => {
    const entered = gate(),
      release = gate();
    const exporter = new InMemorySpanExporter();
    let provider!: NodeTracerProvider;
    const plugin = new Plugin({
      contextExtractor: () => undefined,
      tracerProviderFactory: (ids) =>
        (provider = new NodeTracerProvider({
          idGenerator: ids(),
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        })),
    });
    provider.register();
    const original = provider.forceFlush.bind(provider);
    jest
      .spyOn(provider, "forceFlush")
      .mockImplementationOnce(() => {
        entered.open();
        return release.opened;
      })
      .mockImplementation(original);
    const parent: OperationInfo = {
      id: "parent",
      name: "parent",
      type: "CONTEXT",
      status: "STARTED",
      isReplay: false,
    };
    const callback: OperationInfo = {
      id: "external",
      name: "external",
      type: "CALLBACK",
      status: "SUCCEEDED",
      parentId: parent.id,
      isReplay: false,
    };
    const info: InvocationInfo = {
      requestId: "first",
      executionArn:
        "arn:aws:lambda:us-east-1:123456789012:function:test:$LATEST:execution",
      executionInput: {},
      operations: {},
      updatedOperations: {},
      isFirstInvocation: true,
    };
    await plugin.onInvocationStart(info);
    await plugin.onOperationStart(parent);
    const ending = plugin.onInvocationEnd({ ...info, status: "SUCCEEDED" });
    let parentEnding: Promise<void> | undefined;
    try {
      await entered.opened;
      await plugin.onOperationChange({
        ...info,
        operations: { parent, external: callback },
        updatedOperations: { external: callback },
      });
      release.open();
      for (let turn = 0; turn < turns; turn++) await Promise.resolve();
      // This hook-level test deliberately selects microtask ordering. The live
      // wrapper proves the parent End entered before invocation state was reset.
      const activeParent = plugin.wrapChildContextFn(parent, () =>
        trace.getSpan(context.active())?.spanContext(),
      );
      expect(activeParent).toBeDefined();
      parentEnding = plugin.onOperationEnd({
        ...parent,
        status: "SUCCEEDED",
      });
      await Promise.all([ending, parentEnding]);
      const spans = exporter.getFinishedSpans();
      const callbacks = spans.filter((span) => span.name === "external");
      const parents = spans.filter(
        (span) =>
          span.name === "parent" &&
          span.attributes["durable.operation.status"] === "SUCCEEDED",
      );
      expect(callbacks).toHaveLength(1);
      expect(parents).toHaveLength(1);
      expect(parents[0].spanContext().traceId).toBe(
        callbacks[0].spanContext().traceId,
      );
      if (view === "execution")
        expect(callbacks[0].parentSpanContext?.spanId).toBe(
          parents[0].spanContext().spanId,
        );
      else
        expect(
          spans.some(
            (span) =>
              span.spanContext().spanId ===
              callbacks[0].parentSpanContext?.spanId,
          ),
        ).toBe(true);
    } finally {
      release.open();
      await Promise.all([ending, parentEnding]);
      await provider.shutdown();
      trace.disable();
      context.disable();
    }
  });
});
