import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  SimpleSpanProcessor,
  ConsoleSpanExporter,
  InMemorySpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { DurableOtelPlugin } from "./durable-otel-plugin";
import type {
  InvocationInfo,
  OperationInfo,
  AttemptInfo,
  AttemptEndInfo,
} from "@aws/durable-execution-sdk-js";
import { AttemptEndInfoOutcome } from "@aws/durable-execution-sdk-js";

describe("DurableOtelPlugin with ConsoleSpanExporter", () => {
  const executionArn =
    "arn:aws:lambda:us-east-1:123456789012:function:my-fn:1:exec-abc";

  const invocationInfo: InvocationInfo = {
    requestId: "req-123",
    executionArn,
  };

  it("should export spans to console for a full lifecycle", async () => {
    const memoryExporter = new InMemorySpanExporter();
    const consoleExporter = new ConsoleSpanExporter();

    const provider = new NodeTracerProvider({
      spanProcessors: [
        new SimpleSpanProcessor(memoryExporter),
        new SimpleSpanProcessor(consoleExporter),
      ],
    });
    provider.register();

    const plugin = new DurableOtelPlugin({ provider, samplingRate: 1.0 });

    // --- Simulate execution lifecycle ---
    plugin.onExecutionStart(invocationInfo);
    plugin.onInvocationStart(invocationInfo);

    // Step operation — only attempt hooks (no onOperationStart/End for steps)
    const stepInfo: OperationInfo = {
      Id: "step-1",
      Name: "fetch-data",
      Type: "STEP",
      SubType: "STEP",
      StartTimestamp: new Date(),
    };

    // Attempt 1 — fails and retries
    const attempt1Start: AttemptInfo = { ...stepInfo, Attempt: 1 };
    plugin.onOperationAttemptStart(attempt1Start);
    const attempt1End: AttemptEndInfo = {
      ...attempt1Start,
      outcome: AttemptEndInfoOutcome.RETRYING,
      error: new Error("transient failure"),
      nextAttemptDelaySeconds: 1,
    };
    plugin.onOperationAttemptEnd(attempt1End);

    // Attempt 2 — succeeds
    const attempt2Start: AttemptInfo = { ...stepInfo, Attempt: 2 };
    plugin.onOperationAttemptStart(attempt2Start);
    const attempt2End: AttemptEndInfo = {
      ...attempt2Start,
      outcome: AttemptEndInfoOutcome.SUCCEEDED,
    };
    plugin.onOperationAttemptEnd(attempt2End);

    // Wait operation
    const waitInfo: OperationInfo = {
      Id: "step-2",
      Name: "cooldown",
      Type: "WAIT",
      SubType: "WAIT",
      StartTimestamp: new Date(),
    };
    plugin.onOperationStart(waitInfo);
    plugin.onOperationEnd(waitInfo);

    // End invocation
    await plugin.onInvocationEnd(invocationInfo);

    // --- Verify exported spans ---
    const spans = memoryExporter.getFinishedSpans();

    console.log("\n=== Exported Spans Summary ===");
    for (const span of spans) {
      console.log(
        `  [${span.name}] traceId=${span.spanContext().traceId.slice(0, 8)}... attributes:`,
        span.attributes,
      );
    }
    console.log(`  Total: ${spans.length} spans\n`);

    // We expect: attempt1, attempt2, cooldown (wait operation), invocation
    expect(spans.length).toBe(4);

    // Verify attempt spans have attempt attributes
    const attemptSpans = spans.filter(
      (s) => s.attributes["durable.attempt.number"] !== undefined,
    );
    expect(attemptSpans).toHaveLength(2);
    expect(attemptSpans[0].attributes["durable.attempt.outcome"]).toBe(
      "retrying",
    );
    expect(attemptSpans[1].attributes["durable.attempt.outcome"]).toBe(
      "succeeded",
    );

    // Verify wait operation span has all required attributes
    const operationSpans = spans.filter(
      (s) =>
        s.attributes["durable.operation.id"] !== undefined &&
        s.attributes["durable.attempt.number"] === undefined,
    );
    expect(operationSpans).toHaveLength(1);
    expect(operationSpans[0].attributes["durable.execution.arn"]).toBe(
      executionArn,
    );
    expect(operationSpans[0].attributes["durable.operation.type"]).toBe("wait");

    // Verify invocation span
    const invocationSpan = spans.find((s) => s.name === "invocation");
    expect(invocationSpan).toBeDefined();
    expect(invocationSpan!.attributes["durable.execution.arn"]).toBe(
      executionArn,
    );

    await provider.shutdown();
  });

  it("should export spans for parallel and invoke operations", async () => {
    const memoryExporter = new InMemorySpanExporter();

    const provider = new NodeTracerProvider({
      spanProcessors: [
        new SimpleSpanProcessor(memoryExporter),
        new SimpleSpanProcessor(new ConsoleSpanExporter()),
      ],
    });
    provider.register();

    const plugin = new DurableOtelPlugin({ provider, samplingRate: 1.0 });

    plugin.onExecutionStart(invocationInfo);
    plugin.onInvocationStart(invocationInfo);

    // Parallel operation (parent context)
    const parallelInfo: OperationInfo = {
      Id: "ctx-1",
      Name: "notify",
      Type: "CONTEXT",
      SubType: "PARALLEL",
      StartTimestamp: new Date(),
    };
    plugin.onOperationStart(parallelInfo);

    // Parallel branch 1: step email (only attempt hooks)
    const emailStep: OperationInfo = {
      Id: "ctx-1-1",
      Name: "email",
      Type: "STEP",
      SubType: "STEP",
      ParentId: "ctx-1",
      StartTimestamp: new Date(),
    };
    const emailAttempt: AttemptInfo = { ...emailStep, Attempt: 1 };
    plugin.onOperationAttemptStart(emailAttempt);
    plugin.onOperationAttemptEnd({
      ...emailAttempt,
      outcome: AttemptEndInfoOutcome.SUCCEEDED,
    });

    // Parallel branch 2: step sms (only attempt hooks)
    const smsStep: OperationInfo = {
      Id: "ctx-1-2",
      Name: "sms",
      Type: "STEP",
      SubType: "STEP",
      ParentId: "ctx-1",
      StartTimestamp: new Date(),
    };
    const smsAttempt: AttemptInfo = { ...smsStep, Attempt: 1 };
    plugin.onOperationAttemptStart(smsAttempt);
    plugin.onOperationAttemptEnd({
      ...smsAttempt,
      outcome: AttemptEndInfoOutcome.SUCCEEDED,
    });

    // End parallel
    plugin.onOperationEnd(parallelInfo);

    // Invoke operation
    const invokeInfo: OperationInfo = {
      Id: "step-3",
      Name: "process-payment",
      Type: "CHAINED_INVOKE",
      SubType: "CHAINED_INVOKE",
      StartTimestamp: new Date(),
    };
    plugin.onOperationStart(invokeInfo);
    plugin.onOperationEnd(invokeInfo);

    await plugin.onInvocationEnd(invocationInfo);

    // --- Verify ---
    const spans = memoryExporter.getFinishedSpans();

    console.log("\n=== Exported Spans Summary ===");
    for (const span of spans) {
      console.log(
        `  [${span.name}] traceId=${span.spanContext().traceId.slice(0, 8)}... attributes:`,
        span.attributes,
      );
    }
    console.log(`  Total: ${spans.length} spans\n`);

    // email attempt + sms attempt + parallel op + invoke op + invocation = 5
    expect(spans).toHaveLength(5);

    // All spans share the same traceId
    const traceIds = new Set(spans.map((s) => s.spanContext().traceId));
    expect(traceIds.size).toBe(1);

    // Verify parallel span
    const parallelSpan = spans.find(
      (s) =>
        s.attributes["durable.operation.type"] === "parallel" &&
        s.attributes["durable.attempt.number"] === undefined,
    );
    expect(parallelSpan).toBeDefined();
    expect(parallelSpan!.attributes["durable.operation.name"]).toBe("notify");

    // Verify child step attempt spans have correct types
    const stepAttemptSpans = spans.filter(
      (s) =>
        s.attributes["durable.operation.type"] === "step" &&
        s.attributes["durable.attempt.number"] !== undefined,
    );
    expect(stepAttemptSpans).toHaveLength(2);
    const stepNames = stepAttemptSpans.map(
      (s) => s.attributes["durable.operation.name"],
    );
    expect(stepNames).toContain("email");
    expect(stepNames).toContain("sms");

    // Verify invoke span
    const invokeSpan = spans.find(
      (s) => s.attributes["durable.operation.type"] === "invoke",
    );
    expect(invokeSpan).toBeDefined();
    expect(invokeSpan!.attributes["durable.operation.name"]).toBe(
      "process-payment",
    );
    expect(invokeSpan!.attributes["durable.execution.arn"]).toBe(executionArn);

    await provider.shutdown();
  });
});
