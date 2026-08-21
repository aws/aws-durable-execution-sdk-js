import { XRayClient } from "@aws-sdk/client-xray";
import { handler, getSerializedSpans } from "./otel-retry-steps";
import { createTests } from "../../../utils/test-helper";
import { SerializedSpan } from "../shared/otel-test-setup";
import { assertInvocationViewTraceTopology } from "../shared/otel-test-assertions";
import {
  fetchXRayTrace,
  assertSpanNames,
  assertSpanAttributes,
  extractTraceIdFromXRayHeader,
} from "../../../utils/xray-trace-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures, isCloud }) => {
    it("should produce attempt spans with error status after exhausting retries", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as {
        failed: boolean;
        errorMessage: string;
        spans: SerializedSpan[];
        xRayHeader: string | undefined;
      };

      // The step should have failed after exhausting retries
      expect(result.failed).toBe(true);
      expect(result.errorMessage).toBe("always fails");

      if (isCloud) {
        // Cloud mode: assert spans via X-Ray
        expect(result.xRayHeader).toBeDefined();
        const traceId = extractTraceIdFromXRayHeader(result.xRayHeader!);
        expect(traceId).toBeDefined();

        const xrayClient = new XRayClient({});
        const trace = await fetchXRayTrace(xrayClient, traceId!);

        assertSpanNames(trace, ["retry-step"]);

        // Assert span attributes
        assertSpanAttributes(trace, "retry-step", {
          "durable.operation.type": "STEP",
        });
      } else {
        // Local mode: assert spans via InMemorySpanExporter
        const spans = getSerializedSpans();

        // 3 attempts × (1 operation + 1 attempt) + 3 invocation spans + 1 Workflow span = 10 spans
        expect(spans).toHaveLength(10);

        assertInvocationViewTraceTopology(spans);

        // --- Operation spans for "retry-step" ---
        const retryStepOps = spans.filter(
          (s) =>
            s.attributes["durable.operation.name"] === "retry-step" &&
            s.attributes["durable.operation.type"] === "STEP" &&
            s.attributes["durable.attempt.outcome"] === undefined,
        );
        expect(retryStepOps).toHaveLength(3);

        // The last operation span should have ERROR status (final failure)
        const lastOp = retryStepOps[retryStepOps.length - 1];
        expect(lastOp.status.code).toBe(2);

        // --- Attempt spans ---
        const attemptSpans = spans.filter(
          (s) => s.attributes["durable.attempt.outcome"] !== undefined,
        );
        expect(attemptSpans).toHaveLength(3);

        // Sort by attempt number
        const sorted = attemptSpans.sort(
          (a, b) =>
            (a.attributes["durable.attempt.number"] as number) -
            (b.attributes["durable.attempt.number"] as number),
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
        expect(sorted[0].attributes["durable.attempt.number"]).toBe(1);
        expect(sorted[1].attributes["durable.attempt.number"]).toBe(2);
        expect(sorted[2].attributes["durable.attempt.number"]).toBe(3);

        // --- Invocation spans ---
        const invocationSpans = spans.filter((s) => s.name === "Invocation");
        expect(invocationSpans).toHaveLength(3);
      }

      assertEventSignatures(execution);
    });
  },
});
