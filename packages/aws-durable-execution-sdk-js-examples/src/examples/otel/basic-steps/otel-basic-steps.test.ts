import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";
import { XRayClient } from "@aws-sdk/client-xray";
import { handler, resetExporter, getSerializedSpans } from "./otel-basic-steps";
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
  tests: (runner, { assertEventSignatures, isCloud }) => {
    beforeEach(() => {
      resetExporter();
    });

    it("should produce correct spans for basic steps", async () => {
      const execution = await runner.run();

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      const result = execution.getResult() as {
        result: string;
        spans: SerializedSpan[];
        xRayHeader: string | undefined;
      };

      // Assert result contains expected combined value from 3 steps
      expect(result.result).toBe("step-1-result:step-2-result:step-3-result");

      if (isCloud) {
        // Cloud mode: assert spans via X-Ray
        expect(result.xRayHeader).toBeDefined();
        const traceId = extractTraceIdFromXRayHeader(result.xRayHeader!);
        expect(traceId).toBeDefined();

        const xrayClient = new XRayClient({});
        const trace = await fetchXRayTrace(xrayClient, traceId!, {
          delayMs: 30000,
        });

        assertSpanNames(trace, ["step-1", "step-2", "step-3"]);

        // Assert span attributes
        assertSpanAttributes(trace, "step-1", {
          "durable.operation.type": "STEP",
        });
        assertSpanAttributes(trace, "step-2", {
          "durable.operation.type": "STEP",
        });
        assertSpanAttributes(trace, "step-3", {
          "durable.operation.type": "STEP",
        });
      } else {
        // Local mode: assert spans via InMemorySpanExporter
        const spans = getSerializedSpans();
        // The plugin produces 7 spans: 3 operation spans + 3 attempt spans + 1 invocation span
        expect(spans).toHaveLength(7);

        // Assert all spans share the same traceId
        const traceId = spans[0].traceId;
        expect(spans.every((s) => s.traceId === traceId)).toBe(true);

        // Operation spans are those with type STEP and no attempt attribute
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

        // The invocation span should now be present in the exported spans
        const invocationSpan = spans.find((s) => s.name === "invocation");
        expect(invocationSpan).toBeDefined();
        expect(invocationSpan!.spanId).toBe(invocationSpanId);

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
      }

      assertEventSignatures(execution);
    });
  },
});
