import { XRayClient } from "@aws-sdk/client-xray";
import {
  handler,
  resetExporter,
  getSerializedSpans,
} from "./otel-child-context";
import { createTests } from "../../../utils/test-helper";
import { SerializedSpan } from "../shared/otel-test-setup";
import {
  fetchXRayTrace,
  assertSpanNames,
  assertSpanHierarchy,
  assertSpanAttributes,
  extractTraceIdFromXRayHeader,
} from "../../../utils/xray-trace-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures, isCloud }) => {
    beforeEach(() => {
      resetExporter();
    });

    it("should produce correct parent-child span hierarchy for child context", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as {
        result: string;
        spans: SerializedSpan[];
        xRayHeader: string | undefined;
      };

      // Assert the execution produced the expected result
      expect(result.result).toBe("inner-1-result:inner-2-result");

      if (isCloud) {
        // Cloud mode: assert spans via X-Ray
        expect(result.xRayHeader).toBeDefined();
        const traceId = extractTraceIdFromXRayHeader(result.xRayHeader!);
        expect(traceId).toBeDefined();

        const xrayClient = new XRayClient({});
        const trace = await fetchXRayTrace(xrayClient, traceId!);

        assertSpanNames(trace, ["child-ctx", "inner-step-1", "inner-step-2"]);

        // Assert hierarchy: child-ctx contains inner steps
        assertSpanHierarchy(trace, {
          "child-ctx": ["inner-step-1", "inner-step-2"],
        });

        // Assert span attributes
        assertSpanAttributes(trace, "child-ctx", {
          "durable.operation.type": "CONTEXT",
        });
        assertSpanAttributes(trace, "inner-step-1", {
          "durable.operation.type": "STEP",
        });
        assertSpanAttributes(trace, "inner-step-2", {
          "durable.operation.type": "STEP",
        });
      } else {
        // Local mode: assert spans via InMemorySpanExporter
        const spans = getSerializedSpans();
        // All spans: child-ctx (CONTEXT), inner-step-1 (op + attempt),
        // inner-step-2 (op + attempt), invocation + Workflow = 7 spans
        expect(spans.length).toBe(7);

        // All spans share the same traceId
        const traceId = spans[0].traceId;
        expect(spans.every((s) => s.traceId === traceId)).toBe(true);

        // Find the child context span
        const childCtxSpan = spans.find(
          (s) =>
            s.attributes["durable.operation.name"] === "child-ctx" ||
            s.name === "child-ctx",
        );
        expect(childCtxSpan).toBeDefined();

        // Inner steps should have parentSpanId equal to child context span's spanId
        const innerSpans = spans.filter(
          (s) => s.parentSpanId === childCtxSpan!.spanId,
        );
        expect(innerSpans.length).toBeGreaterThanOrEqual(2);
      }

      assertEventSignatures(execution);
    });
  },
});
