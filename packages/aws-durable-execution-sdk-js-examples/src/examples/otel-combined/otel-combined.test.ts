import { handler } from "./otel-combined";
import { createTests } from "../../utils/test-helper";
import { SerializedSpan } from "../otel-shared/otel-test-setup";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should produce comprehensive spans for all operation types", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as {
        patterns: string;
        childResult: string;
        retryAttempts: number;
        mapItemCount: number;
        complete: boolean;
        spans: SerializedSpan[];
      };

      // Assert result structure
      expect(result.patterns).toBe("step-done");
      expect(result.childResult).toBe("child-a:child-b");
      expect(result.retryAttempts).toBeGreaterThanOrEqual(1);
      expect(result.mapItemCount).toBe(3);
      expect(result.complete).toBe(true);

      const { spans } = result;
      expect(spans.length).toBeGreaterThan(0);

      // All spans share the same traceId (deterministic from execution ARN)
      const traceId = spans[0].traceId;
      expect(spans.every((s) => s.traceId === traceId)).toBe(true);

      // Find child context span
      const childCtxSpan = spans.find(
        (s) =>
          s.attributes["durable.operation.name"] === "child-ctx" ||
          s.name === "child-ctx",
      );
      if (childCtxSpan) {
        // Inner steps should be children of child context span
        const innerSpans = spans.filter(
          (s) => s.parentSpanId === childCtxSpan.spanId,
        );
        expect(innerSpans.length).toBeGreaterThanOrEqual(2);
      }

      // Continuation spans (spans with links) exist for cross-invocation operations
      const spansWithLinks = spans.filter((s) => s.links.length > 0);
      expect(spansWithLinks.length).toBeGreaterThanOrEqual(1);

      // Verify link format (deterministic span IDs)
      for (const span of spansWithLinks) {
        for (const link of span.links) {
          expect(link.spanId).toMatch(/^[0-9a-f]{16}$/);
          expect(link.traceId).toMatch(/^[0-9a-f]{32}$/);
        }
      }

      // Find retry attempt spans with ERROR status
      const errorAttemptSpans = spans.filter(
        (s) =>
          s.attributes["durable.operation.attempt"] !== undefined &&
          s.status.code === 2,
      );
      expect(errorAttemptSpans.length).toBeGreaterThanOrEqual(1);

      assertEventSignatures(execution);
    });
  },
});
