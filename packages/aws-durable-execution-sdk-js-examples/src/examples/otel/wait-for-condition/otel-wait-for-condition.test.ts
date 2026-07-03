import { handler, resetExporter } from "./otel-wait-for-condition";
import { createTests } from "../../../utils/test-helper";
import { SerializedSpan } from "../shared/otel-test-setup";

createTests({
  handler,
  localRunnerConfig: { skipTime: false },
  tests: (runner, { assertEventSignatures }) => {
    beforeEach(() => {
      resetExporter();
    });

    it("immediate mode - condition met on first check", async () => {
      const execution = await runner.run({ payload: { mode: "immediate" } });
      const result = execution.getResult() as {
        finalState: { counter: number };
        mode: string;
        spans: SerializedSpan[];
      };

      // Assert result
      expect(result.finalState.counter).toBe(3);
      expect(result.mode).toBe("immediate");

      const { spans } = result;
      // Single invocation, 1 poll: STEP (op + attempt) = 2 spans
      expect(spans).toHaveLength(2);

      // All spans share the same traceId (deterministic from execution ARN)
      const traceId = spans[0].traceId;
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(spans.every((s) => s.traceId === traceId)).toBe(true);

      // Exactly 1 STEP operation span (single poll)
      const stepOp = spans.find(
        (s) =>
          s.attributes["durable.operation.type"] === "STEP" &&
          s.attributes["durable.operation.attempt"] === undefined,
      );
      expect(stepOp).toBeDefined();

      // Exactly 1 attempt span as child of the operation span
      const attemptSpan = spans.find(
        (s) =>
          s.parentSpanId === stepOp!.spanId &&
          s.attributes["durable.operation.attempt"] === 1,
      );
      expect(attemptSpan).toBeDefined();

      assertEventSignatures(execution, "immediate");
    });

    it("normal mode - condition met after 3 polls", async () => {
      const execution = await runner.run({ payload: { mode: "normal" } });
      const result = execution.getResult() as {
        finalState: { counter: number };
        mode: string;
        spans: SerializedSpan[];
      };

      // Assert result
      expect(result.finalState.counter).toBe(3);
      expect(result.mode).toBe("normal");

      const { spans } = result;
      // All spans across 3 poll invocations: 3 STEP ops + 3 attempts + 2 invocations = 8 spans
      expect(spans).toHaveLength(8);

      // All spans share the same traceId (deterministic from execution ARN)
      const traceId = spans[0].traceId;
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(spans.every((s) => s.traceId === traceId)).toBe(true);

      // 3 STEP operation spans (one per poll)
      const stepOps = spans.filter(
        (s) =>
          s.attributes["durable.operation.type"] === "STEP" &&
          s.attributes["durable.operation.attempt"] === undefined,
      );
      expect(stepOps).toHaveLength(3);

      // Each STEP operation span should have an attempt child
      for (const stepOp of stepOps) {
        const attemptSpan = spans.find(
          (s) =>
            s.parentSpanId === stepOp.spanId &&
            s.attributes["durable.operation.attempt"] !== undefined,
        );
        expect(attemptSpan).toBeDefined();
      }

      // Attempt numbers increment across polls (1, 2, 3)
      const attemptSpans = spans
        .filter((s) => s.attributes["durable.operation.attempt"] !== undefined)
        .sort(
          (a, b) =>
            (a.attributes["durable.operation.attempt"] as number) -
            (b.attributes["durable.operation.attempt"] as number),
        );
      expect(attemptSpans).toHaveLength(3);
      expect(attemptSpans[0].attributes["durable.operation.attempt"]).toBe(1);
      expect(attemptSpans[1].attributes["durable.operation.attempt"]).toBe(2);
      expect(attemptSpans[2].attributes["durable.operation.attempt"]).toBe(3);

      // 2 invocation spans (from resume after wait)
      const invocationSpans = spans.filter((s) => s.name === "invocation");
      expect(invocationSpans).toHaveLength(2);

      // Verify continuation spans with links exist (proves multi-invocation replay)
      const spansWithLinks = spans.filter((s) => s.links.length > 0);
      expect(spansWithLinks.length).toBeGreaterThanOrEqual(1);

      // Verify link span IDs are 16-char hex strings (deterministic span IDs)
      for (const span of spansWithLinks) {
        for (const link of span.links) {
          expect(link.spanId).toMatch(/^[0-9a-f]{16}$/);
          expect(link.traceId).toMatch(/^[0-9a-f]{32}$/);
        }
      }

      assertEventSignatures(execution);
    });

    it("exhausted mode - condition never met", async () => {
      const execution = await runner.run({ payload: { mode: "exhausted" } });

      // Execution should fail because condition was never met and maxAttempts exhausted
      expect(execution.getError()).toBeDefined();

      assertEventSignatures(execution, "exhausted");
    });
  },
});
