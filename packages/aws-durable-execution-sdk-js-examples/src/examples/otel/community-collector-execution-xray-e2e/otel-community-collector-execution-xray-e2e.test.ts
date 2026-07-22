import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";
import { XRayClient } from "@aws-sdk/client-xray";
import {
  handler,
  resetExporter,
  getSerializedSpans,
} from "./otel-community-collector-execution-xray-e2e";
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

    it("should execute workflow and produce traces via ExecutionOtelPlugin", async () => {
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

        // Assert span names exist (ExecutionOtelPlugin produces these)
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

        // ExecutionOtelPlugin-specific: verify Workflow span and Invocation span
        assertSpanNames(trace, ["Workflow", "Invocation"]);

        // Verify Workflow span has durable.execution.arn attribute
        assertSpanAttributes(trace, "Workflow", {
          "durable.execution.status": "SUCCEEDED",
        });

        // Verify Invocation span has Lambda semantic attributes
        assertSpanAttributes(trace, "Invocation", {
          "cloud.provider": "aws",
          "cloud.platform": "aws_lambda",
        });
      } else {
        // Local mode: assert spans via InMemorySpanExporter
        const spans = getSerializedSpans();

        // ExecutionOtelPlugin produces:
        // - 1 Workflow span
        // - 1 Invocation span
        // - 5 operation spans (fetch-data, short-pause, process-data, child-operations, fails-then-succeeds)
        // - 5 attempt spans (fetch-data, process-data, inner-step, fails-then-succeeds x2 failed + 1 success)
        // - 1 inner-step operation span
        // - 1 Context_Execution span for child-operations
        expect(spans.length).toBeGreaterThanOrEqual(12);

        // All spans share the same traceId
        const traceId = spans[0].traceId;
        expect(spans.every((s) => s.traceId === traceId)).toBe(true);

        // Verify Workflow span exists
        const workflowSpan = spans.find((s) => s.name === "Workflow");
        expect(workflowSpan).toBeDefined();
        expect(workflowSpan!.attributes["durable.execution.arn"]).toBeDefined();

        // Verify Invocation span exists and is child of Workflow
        const invocationSpan = spans.find((s) => s.name === "Invocation");
        expect(invocationSpan).toBeDefined();
        expect(invocationSpan!.parentSpanId).toBe(workflowSpan!.spanId);
        expect(invocationSpan!.attributes["cloud.provider"]).toBe("aws");
        expect(invocationSpan!.attributes["cloud.platform"]).toBe("aws_lambda");

        // Verify operation spans exist with correct attributes.
        // Filter out Context_Execution spans (which have "execution" in name)
        // and attempt spans.
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

        // Verify inner-step and fails-then-succeeds exist within child-operations hierarchy
        const innerStepSpan = operationSpans.find(
          (s) => s.attributes["durable.operation.name"] === "inner-step",
        );
        expect(innerStepSpan).toBeDefined();

        const failsThenSucceedsSpan = operationSpans.find(
          (s) =>
            s.attributes["durable.operation.name"] === "fails-then-succeeds",
        );
        expect(failsThenSucceedsSpan).toBeDefined();
        expect(
          failsThenSucceedsSpan!.attributes["durable.operation.type"],
        ).toBe("STEP");

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

        // Verify STEP operation spans have links to an invocation span
        // (During replay, links point to the invocation that exported the span)
        const stepSpans = operationSpans.filter(
          (s) => s.attributes["durable.operation.type"] === "STEP",
        );
        for (const opSpan of stepSpans) {
          expect(opSpan.links.length).toBeGreaterThanOrEqual(1);
        }
      }

      assertEventSignatures(execution, undefined, {
        invocationCompletedDifference: 3,
      });
    });
  },
});
