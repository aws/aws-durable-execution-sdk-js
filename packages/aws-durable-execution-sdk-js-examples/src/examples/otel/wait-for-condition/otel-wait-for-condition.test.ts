import { XRayClient } from "@aws-sdk/client-xray";
import {
  handler,
  resetExporter,
  getSerializedSpans,
} from "./otel-wait-for-condition";
import { createTests } from "../../../utils/test-helper";
import { SerializedSpan } from "../shared/otel-test-setup";
import {
  fetchXRayTrace,
  assertSpanNames,
  assertSpanAttributes,
  extractTraceIdFromXRayHeader,
} from "../../../utils/xray-trace-helper";

createTests({
  handler,
  localRunnerConfig: { skipTime: false },
  tests: (runner, { assertEventSignatures, isCloud }) => {
    beforeEach(() => {
      resetExporter();
    });

    it("immediate mode - condition met on first check", async () => {
      const execution = await runner.run({ payload: { mode: "immediate" } });
      const result = execution.getResult() as {
        finalState: { counter: number };
        mode: string;
        spans: SerializedSpan[];
        xRayHeader: string | undefined;
      };

      // Assert result
      expect(result.finalState.counter).toBe(3);
      expect(result.mode).toBe("immediate");

      if (isCloud) {
        // Cloud mode: assert spans via X-Ray
        expect(result.xRayHeader).toBeDefined();
        const traceId = extractTraceIdFromXRayHeader(result.xRayHeader!);
        expect(traceId).toBeDefined();

        const xrayClient = new XRayClient({});
        const trace = await fetchXRayTrace(xrayClient, traceId!);

        // Should have a STEP span for the waitForCondition operation
        assertSpanNames(trace, ["STEP"]);

        // Assert span attributes
        assertSpanAttributes(trace, "STEP", {
          "durable.operation.type": "STEP",
          "durable.operation.subtype": "WaitForCondition",
        });
      } else {
        // Local mode: assert spans via InMemorySpanExporter
        const spans = getSerializedSpans();
        // Single invocation, 1 poll: STEP (op + attempt) + invocation + Workflow = 4 spans
        expect(spans).toHaveLength(4);

        // All spans share the same traceId (deterministic from execution ARN)
        const traceId = spans[0].traceId;
        expect(traceId).toMatch(/^[0-9a-f]{32}$/);
        expect(spans.every((s) => s.traceId === traceId)).toBe(true);

        // Exactly 1 STEP operation span (single poll)
        const stepOp = spans.find(
          (s) =>
            s.attributes["durable.operation.type"] === "STEP" &&
            s.attributes["durable.attempt.outcome"] === undefined,
        );
        expect(stepOp).toBeDefined();

        // Exactly 1 attempt span as child of the operation span
        const attemptSpan = spans.find(
          (s) =>
            s.parentSpanId === stepOp!.spanId &&
            s.attributes["durable.attempt.number"] === 1,
        );
        expect(attemptSpan).toBeDefined();
      }

      assertEventSignatures(execution, "immediate");
    });

    (isCloud ? it.skip : it)(
      "normal mode - condition met after 3 polls",
      async () => {
        const execution = await runner.run({ payload: { mode: "normal" } });
        const result = execution.getResult() as {
          finalState: { counter: number };
          mode: string;
          spans: SerializedSpan[];
          xRayHeader: string | undefined;
        };

        // Assert result
        expect(result.finalState.counter).toBe(3);
        expect(result.mode).toBe("normal");

        if (isCloud) {
          // Cloud mode: assert spans via X-Ray
          expect(result.xRayHeader).toBeDefined();
          const traceId = extractTraceIdFromXRayHeader(result.xRayHeader!);
          expect(traceId).toBeDefined();

          const xrayClient = new XRayClient({});
          const trace = await fetchXRayTrace(xrayClient, traceId!);

          // Should have STEP spans for the waitForCondition polling
          assertSpanNames(trace, ["STEP"]);

          // Assert span attributes
          assertSpanAttributes(trace, "STEP", {
            "durable.operation.type": "STEP",
            "durable.operation.subtype": "WaitForCondition",
          });
        } else {
          // Local mode: assert spans via InMemorySpanExporter
          const spans = getSerializedSpans();
          // All spans across 3 poll invocations: 3 STEP ops + 3 attempts + 3 invocation spans + 1 Workflow span = 10 spans
          expect(spans).toHaveLength(10);

          // All spans share the same traceId (deterministic from execution ARN)
          const traceId = spans[0].traceId;
          expect(traceId).toMatch(/^[0-9a-f]{32}$/);
          expect(spans.every((s) => s.traceId === traceId)).toBe(true);

          // 3 STEP operation spans (one per poll)
          const stepOps = spans.filter(
            (s) =>
              s.attributes["durable.operation.type"] === "STEP" &&
              s.attributes["durable.attempt.outcome"] === undefined,
          );
          expect(stepOps).toHaveLength(3);

          // Each STEP operation span should have an attempt child
          for (const stepOp of stepOps) {
            const attemptSpan = spans.find(
              (s) =>
                s.parentSpanId === stepOp.spanId &&
                s.attributes["durable.attempt.outcome"] !== undefined,
            );
            expect(attemptSpan).toBeDefined();
          }

          // Attempt numbers increment across polls (1, 2, 3)
          const attemptSpans = spans
            .filter(
              (s) => s.attributes["durable.attempt.outcome"] !== undefined,
            )
            .sort(
              (a, b) =>
                (a.attributes["durable.attempt.number"] as number) -
                (b.attributes["durable.attempt.number"] as number),
            );
          expect(attemptSpans).toHaveLength(3);
          expect(attemptSpans[0].attributes["durable.attempt.number"]).toBe(1);
          expect(attemptSpans[1].attributes["durable.attempt.number"]).toBe(2);
          expect(attemptSpans[2].attributes["durable.attempt.number"]).toBe(3);

          // 3 invocation spans
          const invocationSpans = spans.filter((s) => s.name === "invocation");
          expect(invocationSpans).toHaveLength(3);

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
        }

        assertEventSignatures(execution);
      },
    );

    it("exhausted mode - condition never met", async () => {
      const execution = await runner.run({ payload: { mode: "exhausted" } });

      const result = execution.getResult() as {
        failed: boolean;
        errorMessage: string;
        mode: string;
      };

      // The handler catches the error and returns normally
      expect(result.failed).toBe(true);
      expect(result.errorMessage).toBeDefined();
      expect(result.mode).toBe("exhausted");
      assertEventSignatures(execution, "exhausted");
    });
  },
});
