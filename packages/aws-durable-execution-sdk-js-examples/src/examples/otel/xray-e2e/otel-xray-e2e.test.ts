import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";
import { XRayClient } from "@aws-sdk/client-xray";
import { handler } from "./otel-xray-e2e";
import { createTests } from "../../../utils/test-helper";
import {
  convertToXRayTraceId,
  fetchXRayTrace,
  assertSpanNames,
  assertSpanHierarchy,
} from "../../../utils/xray-trace-helper";

/**
 * Parse the _X_AMZN_TRACE_ID header to extract the trace ID,
 * using the same logic as xRayContextExtractor.
 */
function extractTraceIdFromXRayHeader(header: string): string | undefined {
  const fields = new Map<string, string>();
  for (const part of header.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx > 0) {
      const key = part.slice(0, eqIdx).trim();
      const value = part.slice(eqIdx + 1).trim();
      fields.set(key, value);
    }
  }

  const root = fields.get("Root");
  if (!root) {
    return undefined;
  }

  const rootValue = root.startsWith("1-") ? root.slice(2) : root;
  const traceId = rootValue.replace(/-/g, "").toLowerCase();

  if (!/^[0-9a-f]{32}$/.test(traceId)) {
    return undefined;
  }

  return traceId;
}

createTests({
  handler,
  tests: (runner, { assertEventSignatures, isCloud }) => {
    it("should execute workflow and return trace ID", async () => {
      const execution = await runner.run();
      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      const result = execution.getResult() as {
        xRayHeader: string | undefined;
        result: { step1: string; step2: string; childResult: string };
      };

      // Validate functional result
      expect(result.result.step1).toBe("data-value");
      expect(result.result.step2).toBe("processed-data-value");
      expect(result.result.childResult).toBe("inner-value");

      // X-Ray assertions only in cloud mode
      if (isCloud) {
        expect(result.xRayHeader).toBeDefined();

        // Extract trace ID from the raw header using the same parsing as xRayContextExtractor
        const traceId = extractTraceIdFromXRayHeader(result.xRayHeader!);
        expect(traceId).toBeDefined();
        expect(traceId).toMatch(/^[0-9a-f]{32}$/);

        const xrayClient = new XRayClient({});
        const trace = await fetchXRayTrace(xrayClient, traceId!, {
          expectedMinSegmentCount: 4,
          timeoutMs: 60000,
        });

        // Assert span names exist
        assertSpanNames(trace, [
          "fetch-data",
          "process-data",
          "child-operations",
          "inner-step",
        ]);

        // Assert hierarchy: child-operations contains inner-step
        assertSpanHierarchy(trace, {
          "child-operations": ["inner-step"],
        });

        // Assert all segments share the same trace ID
        const xrayTraceId = convertToXRayTraceId(traceId!);
        for (const segment of trace.segments) {
          expect(segment.trace_id).toBe(xrayTraceId);
        }
      }

      assertEventSignatures(execution);
    });
  },
});
