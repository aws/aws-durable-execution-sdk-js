import { handler } from "./otel-retry-steps";
import { createTests } from "../../../utils/test-helper";
import { SerializedSpan } from "../shared/otel-test-setup";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should produce attempt spans with error status after exhausting retries", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as {
        failed: boolean;
        errorMessage: string;
        spans: SerializedSpan[];
      };

      // The step should have failed after exhausting retries
      expect(result.failed).toBe(true);
      expect(result.errorMessage).toBe("always fails");

      const { spans } = result;

      // 3 attempts × (1 operation + 1 attempt) + 2 invocation spans = 8 spans
      // Each retry triggers a new invocation; the last retry's invocation span
      // is still active when getSerializedSpans() is called.
      expect(spans).toHaveLength(8);

      // All spans share the same traceId
      const traceId = spans[0].traceId;
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(spans.every((s) => s.traceId === traceId)).toBe(true);

      // --- Operation spans for "retry-step" ---
      const retryStepOps = spans.filter(
        (s) =>
          s.attributes["durable.operation.name"] === "retry-step" &&
          s.attributes["durable.operation.type"] === "STEP" &&
          s.attributes["durable.operation.attempt"] === undefined,
      );
      expect(retryStepOps).toHaveLength(3);

      // The last operation span should have ERROR status (final failure)
      const lastOp = retryStepOps[retryStepOps.length - 1];
      expect(lastOp.status.code).toBe(2);

      // --- Attempt spans ---
      const attemptSpans = spans.filter(
        (s) => s.attributes["durable.operation.attempt"] !== undefined,
      );
      expect(attemptSpans).toHaveLength(3);

      // Sort by attempt number
      const sorted = attemptSpans.sort(
        (a, b) =>
          (a.attributes["durable.operation.attempt"] as number) -
          (b.attributes["durable.operation.attempt"] as number),
      );

      // All attempts should be children of their respective operation spans
      for (const span of sorted) {
        const parentOp = retryStepOps.find(
          (op) => op.spanId === span.parentSpanId,
        );
        expect(parentOp).toBeDefined();
      }

      // All attempts should have ERROR status (code 2) since every attempt fails
      for (const span of sorted) {
        expect(span.status.code).toBe(2); // ERROR
        expect(span.status.message).toBeDefined();
      }

      // Verify attempt numbers
      expect(sorted[0].attributes["durable.operation.attempt"]).toBe(1);
      expect(sorted[1].attributes["durable.operation.attempt"]).toBe(2);
      expect(sorted[2].attributes["durable.operation.attempt"]).toBe(3);

      // --- Invocation spans ---
      const invocationSpans = spans.filter((s) => s.name === "invocation");
      expect(invocationSpans).toHaveLength(2);

      assertEventSignatures(execution);
    });
  },
});
