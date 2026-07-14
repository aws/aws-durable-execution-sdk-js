import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";
import { XRayClient } from "@aws-sdk/client-xray";
import {
  handler,
  resetExporter,
  getSerializedSpans,
} from "./otel-standalone-default-provider-xray-e2e";
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

    it("should execute workflow and produce traces via StandaloneOtelPlugin with useDefaultTracerProvider", async () => {
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
        const trace = await fetchXRayTrace(xrayClient, traceId!, {
          delayMs: 30000,
        });

        // Assert span names exist (StandaloneOtelPlugin produces these)
        assertSpanNames(trace, [
          "fetch-data",
          "short-pause",
          "process-data",
          "child-operations",
          "inner-step",
        ]);

        // Assert hierarchy: child-operations contains inner-step
        assertSpanHierarchy(trace, {
          "child-operations": ["inner-step"],
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

        // useDefaultTracerProvider-specific: Workflow span exists as root, NO Invocation span
        assertSpanNames(trace, ["Workflow"]);

        // Verify Workflow span has durable.execution.arn attribute and status
        assertSpanAttributes(trace, "Workflow", {
          "durable.execution.status": "SUCCEEDED",
        });

        // Verify NO Invocation span is created by the plugin
        const allSpanNames = trace.segments.map((seg) => seg.name);
        const invocationSpans = allSpanNames.filter(
          (name) => name === "Invocation",
        );
        expect(invocationSpans.length).toBe(0);

        // Verify operation spans have span links to the ambient invocation span.
        // In cloud mode (Lambda layer), the ambient invocation span is captured
        // via context.active() and linked on operation/attempt spans.
        // X-Ray represents links in metadata — we verify the operation spans exist
        // and are properly parented under Workflow.
        assertSpanHierarchy(trace, {
          Workflow: [
            "fetch-data",
            "short-pause",
            "process-data",
            "child-operations",
          ],
        });
      } else {
        // Local mode: assert spans via InMemorySpanExporter
        const spans = getSerializedSpans();

        // useDefaultTracerProvider mode produces:
        // - 1 Workflow span (root, no parent)
        // - NO Invocation span (ambient context is used instead)
        // - 4 operation spans (fetch-data, short-pause, process-data, child-operations)
        // - 3 attempt spans (one per step: fetch-data, process-data, inner-step)
        // - 1 inner-step operation span
        // - 1 Context_Execution span for child-operations
        expect(spans.length).toBeGreaterThanOrEqual(8);

        // All spans share the same traceId
        const traceId = spans[0].traceId;
        expect(spans.every((s) => s.traceId === traceId)).toBe(true);

        // Verify Workflow span exists as root (no parent)
        const workflowSpan = spans.find((s) => s.name === "Workflow");
        expect(workflowSpan).toBeDefined();
        expect(workflowSpan!.parentSpanId).toBeUndefined();
        expect(workflowSpan!.attributes["durable.execution.arn"]).toBeDefined();

        // Verify NO Invocation span exists (useDefaultTracerProvider mode)
        const invocationSpan = spans.find((s) => s.name === "Invocation");
        expect(invocationSpan).toBeUndefined();

        // Verify operation spans exist with correct attributes.
        const operationSpans = spans.filter(
          (s) =>
            s.attributes["durable.operation.type"] !== undefined &&
            s.attributes["durable.operation.attempt"] === undefined &&
            s.attributes["durable.operation.subtype"] !== undefined &&
            s.name !== "Workflow" &&
            s.name !== "Invocation",
        );

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

        // Verify inner-step is nested under child-operations
        const innerStepSpan = operationSpans.find(
          (s) => s.attributes["durable.operation.name"] === "inner-step",
        );
        expect(innerStepSpan).toBeDefined();
        expect(innerStepSpan!.parentSpanId).toBe(childOpsSpan!.spanId);

        // Verify attempt spans exist
        const attemptSpans = spans.filter(
          (s) => s.attributes["durable.operation.attempt"] !== undefined,
        );
        expect(attemptSpans.length).toBeGreaterThanOrEqual(3);

        // Each attempt span should be a child of its corresponding operation span
        for (const attemptSpan of attemptSpans) {
          const parentOp = operationSpans.find(
            (op) => op.spanId === attemptSpan.parentSpanId,
          );
          expect(parentOp).toBeDefined();
        }

        // In local mode (no Lambda layer), there is NO ambient invocation span,
        // so span links on operations will be EMPTY.
        const stepSpans = operationSpans.filter(
          (s) => s.attributes["durable.operation.type"] === "STEP",
        );
        for (const opSpan of stepSpans) {
          expect(opSpan.links.length).toBe(0);
        }
      }

      assertEventSignatures(execution);
    });
  },
});
