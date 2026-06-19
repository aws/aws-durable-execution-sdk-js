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

createTests({
  handler,
  tests: (runner, { assertEventSignatures, isCloud }) => {
    it("should execute workflow and return trace ID", async () => {
      const execution = await runner.run();
      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      const result = execution.getResult() as {
        traceId: string | undefined;
        result: { step1: string; step2: string; childResult: string };
      };

      // Validate functional result
      expect(result.result.step1).toBe("data-value");
      expect(result.result.step2).toBe("processed-data-value");
      expect(result.result.childResult).toBe("inner-value");

      // X-Ray assertions only in cloud mode
      if (isCloud) {
        expect(result.traceId).toBeDefined();
        expect(result.traceId).toMatch(/^[0-9a-f]{32}$/);

        const xrayClient = new XRayClient({});
        const trace = await fetchXRayTrace(xrayClient, result.traceId!, {
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
        const xrayTraceId = convertToXRayTraceId(result.traceId!);
        for (const segment of trace.segments) {
          expect(segment.trace_id).toBe(xrayTraceId);
        }
      }

      assertEventSignatures(execution);
    });
  },
});
