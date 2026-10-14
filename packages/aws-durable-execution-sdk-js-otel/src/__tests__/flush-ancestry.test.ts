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
import {
  deriveSpanIdFromOperationId,
  deriveWorkflowSpanId,
} from "../deterministic-id-generator";

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
};

describe("execution view ancestry received during flush", () => {
  it.each([
    ["newly abandoned parent", "PENDING", "SUCCEEDED", "workflow"],
    ["completed parent", "SUCCEEDED", "SUCCEEDED", "parent"],
    ["unfinished ancestor", "PENDING", "PENDING", "parent"],
    ["unknown ancestor", "PENDING", undefined, "parent"],
  ] as const)(
    "uses the current snapshot for %s",
    async (_, parentStatus, ancestorStatus, expectedParent) => {
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
      const ancestor: OperationInfo = {
        id: "ancestor",
        type: "CONTEXT",
        status: "PENDING",
        isReplay: true,
      };
      const parent: OperationInfo = {
        id: "parent",
        parentId: ancestor.id,
        type: "CONTEXT",
        status: "PENDING",
        isReplay: true,
      };
      const completion: OperationInfo = {
        id: "callback",
        name: "external",
        parentId: parent.id,
        type: "CALLBACK",
        status: "SUCCEEDED",
        isReplay: false,
        startTimestamp: new Date(10),
        endTimestamp: new Date(20),
      };
      const info: InvocationInfo = {
        requestId: "resume",
        executionArn:
          "arn:aws:lambda:us-east-1:123456789012:function:test:$LATEST:execution",
        executionInput: {},
        isFirstInvocation: false,
        operations: { ancestor, parent },
        updatedOperations: {},
      };
      const entered = gate(),
        release = gate();
      const flush = jest
        .spyOn(provider, "forceFlush")
        .mockImplementationOnce(async () => {
          entered.open();
          await release.opened;
        })
        .mockResolvedValue(undefined);
      await plugin.onInvocationStart(info);
      const ending = plugin.onInvocationEnd({ ...info, status: "PENDING" });
      try {
        await entered.opened;
        const operations: Record<string, OperationInfo> = {
          parent: { ...parent, status: parentStatus },
          callback: completion,
        };
        if (ancestorStatus)
          operations.ancestor = { ...ancestor, status: ancestorStatus };
        await plugin.onOperationChange({
          executionArn: info.executionArn,
          operations,
          updatedOperations: { callback: completion },
        });
        release.open();
        await ending;
        const spans = exporter
          .getFinishedSpans()
          .filter((span) => span.name === "external");
        expect(spans).toHaveLength(1);
        expect(spans[0].parentSpanContext?.spanId).toBe(
          expectedParent === "workflow"
            ? deriveWorkflowSpanId(info.executionArn)
            : deriveSpanIdFromOperationId(parent.id, info.executionArn),
        );
        expect(flush).toHaveBeenCalledTimes(2);
        // A replay has no fresh completion to export, even with the same IDs.
        await plugin.onInvocationStart({
          ...info,
          requestId: "later",
          operations,
        });
        await plugin.onInvocationEnd({
          ...info,
          requestId: "later",
          operations,
          status: "PENDING",
        });
        expect(
          exporter
            .getFinishedSpans()
            .filter((span) => span.name === "external"),
        ).toHaveLength(1);
      } finally {
        release.open();
        await ending;
        await provider.shutdown();
        trace.disable();
        context.disable();
      }
    },
  );
});
