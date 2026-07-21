import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";
import { XRayClient } from "@aws-sdk/client-xray";
import {
  handler,
  resetExporter,
  getSerializedSpans,
} from "./otel-community-collector-invocation-xray-e2e";
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

    it("should execute workflow and produce traces via InvocationOtelPlugin", async () => {
      const execution = await runner.run();
      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      const result = execution.getResult() as {
        xRayHeader: string | undefined;
        result: { step1: string; step2: string; childResult: string };
        spans: SerializedSpan[];
      };

      // Validate functional result
      expect(result.result.step1).toBe("data-value");
      expect(result.result.step2).toBe("processed-data-value");
      expect(result.result.childResult).toBe("inner-value");

      if (isCloud) {
        // Cloud mode: assert spans via X-Ray
        expect(result.xRayHeader).toBeDefined();

        // Extract trace ID from the raw header
        const traceId = extractTraceIdFromXRayHeader(result.xRayHeader!);
        expect(traceId).toBeDefined();
        expect(traceId).toMatch(/^[0-9a-f]{32}$/);

        const xrayClient = new XRayClient({});
        const trace = await fetchXRayTrace(xrayClient, traceId!);

        // Assert span names exist (InvocationOtelPlugin produces operation spans + Workflow span)
        assertSpanNames(trace, [
          "Workflow",
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

        // Verify Workflow span has execution status
        assertSpanAttributes(trace, "Workflow", {
          "durable.execution.status": "SUCCEEDED",
        });
      } else {
        // Local mode: assert spans via InMemorySpanExporter
        const spans = getSerializedSpans();

        // Verify Workflow span exists (InvocationOtelPlugin creates it in community collector mode)
        const workflowSpan = spans.find((s) => s.name === "Workflow");
        expect(workflowSpan).toBeDefined();
        expect(workflowSpan!.attributes["durable.execution.arn"]).toBeDefined();

        // Verify Invocation span exists and is child of Workflow
        const invocationSpan = spans.find((s) => s.name === "invocation");
        expect(invocationSpan).toBeDefined();
        expect(invocationSpan!.parentSpanId).toBe(workflowSpan!.spanId);

        // Filter to operation spans: have durable.operation.type but NOT durable.operation.attempt
        const operationSpans = spans.filter(
          (s) =>
            s.attributes["durable.operation.type"] !== undefined &&
            s.attributes["durable.operation.attempt"] === undefined,
        );

        // Verify operation spans exist with correct attributes by durable.operation.name
        const fetchDataSpan = operationSpans.find(
          (s) => s.attributes["durable.operation.name"] === "fetch-data",
        );
        expect(fetchDataSpan).toBeDefined();
        expect(fetchDataSpan!.attributes["durable.operation.type"]).toBe(
          "STEP",
        );

        const processDataSpan = operationSpans.find(
          (s) => s.attributes["durable.operation.name"] === "process-data",
        );
        expect(processDataSpan).toBeDefined();
        expect(processDataSpan!.attributes["durable.operation.type"]).toBe(
          "STEP",
        );

        const childOpsSpan = operationSpans.find(
          (s) => s.attributes["durable.operation.name"] === "child-operations",
        );
        expect(childOpsSpan).toBeDefined();
        expect(childOpsSpan!.attributes["durable.operation.type"]).toBe(
          "CONTEXT",
        );

        const innerStepSpan = operationSpans.find(
          (s) => s.attributes["durable.operation.name"] === "inner-step",
        );
        expect(innerStepSpan).toBeDefined();
        expect(innerStepSpan!.attributes["durable.operation.type"]).toBe(
          "STEP",
        );

        const failsThenSucceedsSpan = operationSpans.find(
          (s) =>
            s.attributes["durable.operation.name"] === "fails-then-succeeds",
        );
        expect(failsThenSucceedsSpan).toBeDefined();
        expect(
          failsThenSucceedsSpan!.attributes["durable.operation.type"],
        ).toBe("STEP");

        // All operation spans share the same traceId
        const traceId = operationSpans[0].traceId;
        expect(operationSpans.every((s) => s.traceId === traceId)).toBe(true);

        // Verify inner-step is nested under child-operations
        expect(innerStepSpan!.parentSpanId).toBe(childOpsSpan!.spanId);

        // Verify fails-then-succeeds is nested under child-operations
        expect(failsThenSucceedsSpan!.parentSpanId).toBe(childOpsSpan!.spanId);
      }

      assertEventSignatures(execution, undefined, {
        invocationCompletedDifference: 2,
      });
    });
  },
});
