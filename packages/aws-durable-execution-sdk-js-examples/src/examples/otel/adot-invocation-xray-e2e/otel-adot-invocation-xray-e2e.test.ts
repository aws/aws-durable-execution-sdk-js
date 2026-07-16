import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";
import { XRayClient } from "@aws-sdk/client-xray";
import { handler } from "./otel-adot-invocation-xray-e2e";
import { createTests } from "../../../utils/test-helper";
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
          delayMs: 30000,
        });

        // Assert span names exist
        assertSpanNames(trace, [
          "fetch-data",
          "short-pause",
          "process-data",
          "child-operations",
          "inner-step",
          "fails-then-succeeds",
        ]);

        // Assert hierarchy: child-operations contains inner-step and fails-then-succeeds
        assertSpanHierarchy(trace, {
          "child-operations": ["inner-step", "fails-then-succeeds"],
        });

        // Assert span attributes
        assertSpanAttributes(trace, "fetch-data", {
          "durable.operation.type": "STEP",
        });
        assertSpanAttributes(trace, "process-data", {
          "durable.operation.type": "STEP",
        });
        assertSpanAttributes(trace, "child-operations", {
          "durable.operation.type": "CONTEXT",
        });
        assertSpanAttributes(trace, "inner-step", {
          "durable.operation.type": "STEP",
        });
        assertSpanAttributes(trace, "fails-then-succeeds", {
          "durable.operation.type": "STEP",
        });
      }

      assertEventSignatures(execution);
    });
  },
});
