import { context, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import type {
  InvocationInfo,
  OperationEndInfo,
} from "@aws/durable-execution-sdk-js";
import { ExecutionOtelPlugin } from "../execution-plugin";
import { deriveSpanIdFromOperationId } from "../deterministic-id-generator";

const invocation: InvocationInfo = {
  requestId: "first",
  executionArn: "arn:execution:replay",
  isFirstInvocation: true,
  executionInput: {},
  operations: {},
  updatedOperations: {},
  executionStartTimestamp: new Date("2026-01-01T00:00:00Z"),
};
const start = new Date("2026-01-01T00:00:01Z");
const end = new Date("2026-01-01T00:00:02Z");

describe("execution view external completion exports", () => {
  let exporter: InMemorySpanExporter;
  let providers: NodeTracerProvider[];
  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    providers = [];
  });
  afterEach(async () => {
    await Promise.all(providers.map((provider) => provider.shutdown()));
    context.disable();
    trace.disable();
  });
  function plugin(): ExecutionOtelPlugin {
    return new ExecutionOtelPlugin({
      contextExtractor: () => undefined,
      tracerProviderFactory: (createIdGenerator) => {
        const provider = new NodeTracerProvider({
          idGenerator: createIdGenerator(),
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        });
        providers.push(provider);
        return provider;
      },
    });
  }
  it.each(["WAIT", "INVOKE", "CHAINED_INVOKE", "CALLBACK"])(
    "exports %s first completion but not later stored successes or failures",
    async (type) => {
      for (const status of ["SUCCEEDED", "FAILED"] as const) {
        const id = `${type}-${status}`;
        const completion: OperationEndInfo = {
          id,
          name: id,
          type,
          status,
          isReplay: false,
          startTimestamp: start,
          endTimestamp: end,
          ...(status === "FAILED"
            ? { error: new Error("failed externally") }
            : {}),
        };
        // Separate instances model resumes in fresh execution environments.
        const initial = plugin();
        await initial.onInvocationStart(invocation);
        await initial.onOperationStart(completion);
        await initial.onInvocationEnd({ ...invocation, status: "PENDING" });
        for (let resume = 0; resume < 3; resume++) {
          const current = plugin();
          const info = {
            ...invocation,
            requestId: `resume-${resume}`,
            isFirstInvocation: false,
          };
          await current.onInvocationStart(info);
          await current.onOperationStart({
            ...completion,
            isReplay: resume > 0,
          });
          await current.onOperationEnd({ ...completion, isReplay: resume > 0 });
          // A new operation still exports during the invocation replaying old work.
          await current.onOperationStart({
            id: `${id}-new-${resume}`,
            type: "STEP",
            isReplay: false,
          });
          await current.onOperationEnd({
            id: `${id}-new-${resume}`,
            type: "STEP",
            status: "SUCCEEDED",
            isReplay: false,
          });
          await current.onInvocationEnd({
            ...info,
            status: resume === 2 ? "SUCCEEDED" : "PENDING",
          });
        }
        const spans = exporter
          .getFinishedSpans()
          .filter((span) => span.attributes["durable.operation.id"] === id);
        expect(spans).toHaveLength(1);
        expect(spans[0].spanContext().spanId).toBe(
          deriveSpanIdFromOperationId(id, invocation.executionArn),
        );
        expect(spans[0].startTime).toEqual([start.getTime() / 1000, 0]);
        expect(spans[0].endTime).toEqual([end.getTime() / 1000, 0]);
        expect(spans[0].attributes["durable.operation.status"]).toBe(status);
        expect(
          exporter
            .getFinishedSpans()
            .filter((span) =>
              String(span.attributes["durable.operation.id"]).startsWith(
                `${id}-new-`,
              ),
            ),
        ).toHaveLength(3);
      }
    },
  );
  it("allows identical first-completion redelivery after an interrupted invocation", async () => {
    for (let delivery = 0; delivery < 2; delivery++) {
      const current = plugin();
      await current.onInvocationStart({
        ...invocation,
        requestId: `delivery-${delivery}`,
        isFirstInvocation: false,
      });
      await current.onOperationEnd({
        id: "redelivered",
        type: "WAIT",
        isReplay: false,
        status: "SUCCEEDED",
        startTimestamp: start,
        endTimestamp: end,
      });
      await current.onInvocationEnd({ ...invocation, status: "PENDING" });
    }
    const spans = exporter
      .getFinishedSpans()
      .filter(
        (span) => span.attributes["durable.operation.id"] === "redelivered",
      );
    expect(spans).toHaveLength(2);
    expect(spans[0].spanContext()).toEqual(spans[1].spanContext());
    expect(spans[0].startTime).toEqual(spans[1].startTime);
    expect(spans[0].endTime).toEqual(spans[1].endTime);
  });
});
