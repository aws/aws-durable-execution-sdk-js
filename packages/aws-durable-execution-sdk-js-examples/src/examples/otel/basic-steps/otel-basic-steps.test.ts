import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";
import { handler, resetExporter } from "./otel-basic-steps";
import { createTests } from "../../../utils/test-helper";
import { SerializedSpan } from "../shared/otel-test-setup";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    beforeEach(() => {
      resetExporter();
    });

    it("should produce correct spans for basic steps", async () => {
      const execution = await runner.run();

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      const result = execution.getResult() as {
        result: string;
        spans: SerializedSpan[];
      };

      // Assert result contains expected combined value from 3 steps
      expect(result.result).toBe("step-1-result:step-2-result:step-3-result");

      // The plugin produces 6 spans: 3 operation spans + 3 attempt spans
      // (The invocation span is still active when getSerializedSpans() is called)
      const { spans } = result;
      expect(spans).toHaveLength(6);

      // Assert all spans share the same traceId
      const traceId = spans[0].traceId;
      expect(spans.every((s) => s.traceId === traceId)).toBe(true);

      // Operation spans are those whose parentSpanId points to the invocation span
      // (which is not in the exported batch). They have no `durable.operation.attempt` attribute.
      const opSpans = spans.filter(
        (s) =>
          s.attributes["durable.operation.type"] === "STEP" &&
          s.attributes["durable.operation.attempt"] === undefined,
      );
      expect(opSpans).toHaveLength(3);

      // All operation spans share the same parentSpanId (the invocation span)
      const invocationSpanId = opSpans[0].parentSpanId;
      expect(invocationSpanId).toBeDefined();
      expect(opSpans.every((s) => s.parentSpanId === invocationSpanId)).toBe(
        true,
      );

      // Assert operation spans have correct durable.operation.name
      expect(opSpans[0].attributes["durable.operation.name"]).toBe("step-1");
      expect(opSpans[1].attributes["durable.operation.name"]).toBe("step-2");
      expect(opSpans[2].attributes["durable.operation.name"]).toBe("step-3");

      // Attempt spans are children of their respective operation spans
      const attemptSpans = spans.filter(
        (s) => s.attributes["durable.operation.attempt"] !== undefined,
      );
      expect(attemptSpans).toHaveLength(3);

      // Each attempt span's parentSpanId should equal its corresponding operation span's spanId
      for (const attemptSpan of attemptSpans) {
        const parentOp = opSpans.find(
          (op) => op.spanId === attemptSpan.parentSpanId,
        );
        expect(parentOp).toBeDefined();
        expect(attemptSpan.attributes["durable.operation.attempt"]).toBe(1);
      }

      assertEventSignatures(execution);
    });
  },
});
