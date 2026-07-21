import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { XRayClient } from "@aws-sdk/client-xray";
import { handler, resetExporter, getSerializedSpans } from "./otel-invoke";
import { handler as basicStepsHandler } from "../basic-steps/otel-basic-steps";
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
  tests: (runner, { functionNameMap, assertEventSignatures, isCloud }) => {
    beforeEach(() => {
      resetExporter();
    });

    it("should produce CHAINED_INVOKE spans with continuation links", async () => {
      if (runner instanceof LocalDurableTestRunner) {
        runner.registerDurableFunction(
          functionNameMap.getFunctionName("otel-basic-steps"),
          basicStepsHandler,
        );
      }

      const execution = await runner.run({
        payload: {
          functionName: functionNameMap.getFunctionName("otel-basic-steps"),
        },
      });

      const result = execution.getResult() as {
        invokeResult: unknown;
        beforeInvoke: string;
        afterInvoke: string;
        spans: SerializedSpan[];
        xRayHeader: string | undefined;
      };

      expect(result.beforeInvoke).toBe("before-invoke-value");
      expect((result.invokeResult as any).result).toBe(
        "step-1-result:step-2-result:step-3-result",
      );
      expect(result.afterInvoke).toBe("after-invoke-value");

      if (isCloud) {
        // Cloud mode: assert spans via X-Ray
        expect(result.xRayHeader).toBeDefined();
        const traceId = extractTraceIdFromXRayHeader(result.xRayHeader!);
        expect(traceId).toBeDefined();

        const xrayClient = new XRayClient({});
        const trace = await fetchXRayTrace(xrayClient, traceId!, {
          delayMs: 30000,
        });

        assertSpanNames(trace, [
          "before-invoke",
          "invoke-target",
          "after-invoke",
        ]);

        // Assert span attributes
        assertSpanAttributes(trace, "before-invoke", {
          "durable.operation.type": "STEP",
        });
        assertSpanAttributes(trace, "invoke-target", {
          "durable.operation.type": "CHAINED_INVOKE",
        });
        assertSpanAttributes(trace, "after-invoke", {
          "durable.operation.type": "STEP",
        });
      } else {
        // Local mode: assert spans via InMemorySpanExporter
        const spans = getSerializedSpans();
        // With exporter reset at the test level (not inside the handler), we capture
        // all spans across all invocations:
        // Invocation 1: "before-invoke" (operation + attempt), "invoke-target" (CHAINED_INVOKE), "invocation"
        // Invocation 2: "invoke-target" (continuation), "after-invoke" (operation + attempt), "invocation"
        // + 1 Workflow span
        expect(spans).toHaveLength(8);

        // All spans share the same traceId
        const traceId = spans[0].traceId;
        expect(traceId).toMatch(/^[0-9a-f]{32}$/);
        expect(spans.every((s) => s.traceId === traceId)).toBe(true);

        // --- before-invoke step ---
        const beforeInvokeOp = spans.find(
          (s) =>
            s.attributes["durable.operation.name"] === "before-invoke" &&
            s.attributes["durable.operation.type"] === "STEP" &&
            s.attributes["durable.operation.attempt"] === undefined,
        );
        expect(beforeInvokeOp).toBeDefined();

        const beforeInvokeAttempt = spans.find(
          (s) =>
            s.parentSpanId === beforeInvokeOp!.spanId &&
            s.attributes["durable.operation.attempt"] === 1,
        );
        expect(beforeInvokeAttempt).toBeDefined();

        // --- invoke-target (CHAINED_INVOKE) span ---
        const invokeSpan = spans.find(
          (s) =>
            s.attributes["durable.operation.name"] === "invoke-target" &&
            s.attributes["durable.operation.type"] === "CHAINED_INVOKE",
        );
        expect(invokeSpan).toBeDefined();

        // --- invocation span ---
        const invocationSpan = spans.find((s) => s.name === "invocation");
        expect(invocationSpan).toBeDefined();

        // --- after-invoke step ---
        const afterInvokeOp = spans.find(
          (s) =>
            s.attributes["durable.operation.name"] === "after-invoke" &&
            s.attributes["durable.operation.type"] === "STEP" &&
            s.attributes["durable.operation.attempt"] === undefined,
        );
        expect(afterInvokeOp).toBeDefined();

        const afterInvokeAttempt = spans.find(
          (s) =>
            s.parentSpanId === afterInvokeOp!.spanId &&
            s.attributes["durable.operation.attempt"] === 1,
        );
        expect(afterInvokeAttempt).toBeDefined();

        // --- Continuation spans with links (cross-invocation correlation) ---
        const spansWithLinks = spans.filter((s) => s.links.length > 0);
        expect(spansWithLinks.length).toBeGreaterThanOrEqual(1);
        for (const span of spansWithLinks) {
          for (const link of span.links) {
            expect(link.spanId).toMatch(/^[0-9a-f]{16}$/);
            expect(link.traceId).toMatch(/^[0-9a-f]{32}$/);
          }
        }
      }

      assertEventSignatures(execution);
    });
  },
});
