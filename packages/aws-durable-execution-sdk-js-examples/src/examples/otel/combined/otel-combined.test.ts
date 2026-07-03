import { handler, getSerializedSpans } from "./otel-combined";
import { createTests } from "../../../utils/test-helper";
import { SerializedSpan } from "../shared/otel-test-setup";

createTests({
  handler,
  tests: (runner, { assertEventSignatures, isCloud }) => {
    it("should produce comprehensive spans for all operation types", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as {
        patterns: string;
        childResult: string;
        mapItemCount: number;
        complete: boolean;
        spans: SerializedSpan[];
      };

      // Assert result structure
      expect(result.patterns).toBe("step-done");
      expect(result.childResult).toBe("child-a:child-b");
      expect(result.mapItemCount).toBe(3);
      expect(result.complete).toBe(true);

      const spans = isCloud ? result.spans : getSerializedSpans();

      // All spans share the same traceId (deterministic from execution ARN)
      const traceId = spans[0].traceId;
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(spans.every((s) => s.traceId === traceId)).toBe(true);

      // --- Sequential step span ---
      const sequentialStepOp = spans.find(
        (s) =>
          s.attributes["durable.operation.name"] === "sequential-step" &&
          s.attributes["durable.operation.type"] === "STEP" &&
          s.attributes["durable.operation.attempt"] === undefined,
      );
      expect(sequentialStepOp).toBeDefined();

      const sequentialStepAttempt = spans.find(
        (s) =>
          s.parentSpanId === sequentialStepOp!.spanId &&
          s.attributes["durable.operation.attempt"] === 1,
      );
      expect(sequentialStepAttempt).toBeDefined();

      // --- Wait span ---
      const waitSpan = spans.find(
        (s) => s.attributes["durable.operation.name"] === "short-wait",
      );
      expect(waitSpan).toBeDefined();
      expect(waitSpan!.attributes["durable.operation.type"]).toBe("WAIT");

      // --- Child context span ---
      const childCtxSpan = spans.find(
        (s) =>
          s.attributes["durable.operation.name"] === "child-ctx" &&
          s.attributes["durable.operation.type"] === "CONTEXT",
      );
      expect(childCtxSpan).toBeDefined();

      // Inner steps should be children of child context span
      const childStep1 = spans.find(
        (s) =>
          s.attributes["durable.operation.name"] === "child-step-1" &&
          s.parentSpanId === childCtxSpan!.spanId,
      );
      const childStep2 = spans.find(
        (s) =>
          s.attributes["durable.operation.name"] === "child-step-2" &&
          s.parentSpanId === childCtxSpan!.spanId,
      );
      expect(childStep1).toBeDefined();
      expect(childStep2).toBeDefined();

      // --- Map context span ---
      const mapCtxSpan = spans.find(
        (s) =>
          s.attributes["durable.operation.name"] === "map-items" &&
          s.attributes["durable.operation.type"] === "CONTEXT",
      );
      expect(mapCtxSpan).toBeDefined();

      // Map step spans (3 items)
      for (let i = 0; i < 3; i++) {
        const mapStepOp = spans.find(
          (s) =>
            s.attributes["durable.operation.name"] === `map-step-${i}` &&
            s.attributes["durable.operation.type"] === "STEP",
        );
        expect(mapStepOp).toBeDefined();
      }

      // --- Parallel context span ---
      const parallelCtxSpan = spans.find(
        (s) =>
          s.attributes["durable.operation.name"] === "parallel-ops" &&
          s.attributes["durable.operation.type"] === "CONTEXT",
      );
      expect(parallelCtxSpan).toBeDefined();

      // Parallel step spans
      const parallelStep1 = spans.find(
        (s) => s.attributes["durable.operation.name"] === "parallel-step-1",
      );
      const parallelStep2 = spans.find(
        (s) => s.attributes["durable.operation.name"] === "parallel-step-2",
      );
      expect(parallelStep1).toBeDefined();
      expect(parallelStep2).toBeDefined();

      // --- Continuation spans (cross-invocation links) ---
      const spansWithLinks = spans.filter((s) => s.links.length > 0);
      expect(spansWithLinks.length).toBeGreaterThanOrEqual(1);

      // Verify link format (deterministic span IDs)
      for (const span of spansWithLinks) {
        for (const link of span.links) {
          expect(link.spanId).toMatch(/^[0-9a-f]{16}$/);
          expect(link.traceId).toMatch(/^[0-9a-f]{32}$/);
        }
      }

      assertEventSignatures(execution);
    });
  },
});
