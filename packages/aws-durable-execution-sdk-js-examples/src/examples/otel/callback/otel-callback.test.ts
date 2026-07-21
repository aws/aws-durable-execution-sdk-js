import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { XRayClient } from "@aws-sdk/client-xray";
import { handler, resetExporter, getSerializedSpans } from "./otel-callback";
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
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures, isCloud }) => {
    beforeEach(() => {
      resetExporter();
    });

    it("should produce CALLBACK spans with continuation links", async () => {
      const executionPromise = runner.run();

      const waitForCallbackOp = runner.getOperationByIndex(1);
      await waitForCallbackOp.waitForData(WaitingOperationStatus.SUBMITTED);
      await waitForCallbackOp.sendCallbackSuccess("callback-value");

      const execution = await executionPromise;
      const result = execution.getResult() as {
        callbackResult: unknown;
        beforeCallback: string;
        afterCallback: string;
        spans: SerializedSpan[];
        xRayHeader: string | undefined;
      };

      expect(result.beforeCallback).toBe("before-callback-value");
      expect(result.callbackResult).toBe("callback-value");
      expect(result.afterCallback).toBe("after-callback-value");

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
          "before-callback",
          "my-callback",
          "after-callback",
        ]);

        // Assert span attributes
        assertSpanAttributes(trace, "before-callback", {
          "durable.operation.type": "STEP",
        });
        assertSpanAttributes(trace, "my-callback", {
          "durable.operation.type": "CONTEXT",
        });
        assertSpanAttributes(trace, "after-callback", {
          "durable.operation.type": "STEP",
        });
      } else {
        // Local mode: assert spans via InMemorySpanExporter
        const spans = getSerializedSpans();
        // All spans across all invocations: before-callback (op + attempt),
        // STEP (submitter op + attempt), CALLBACK, my-callback (CONTEXT), invocation,
        // my-callback (continuation), after-callback (op + attempt), invocation (2nd) + Workflow = 12 spans
        expect(spans).toHaveLength(12);

        // All spans share the same traceId
        const traceId = spans[0].traceId;
        expect(traceId).toMatch(/^[0-9a-f]{32}$/);
        expect(spans.every((s) => s.traceId === traceId)).toBe(true);

        // --- before-callback step ---
        const beforeCallbackOp = spans.find(
          (s) =>
            s.attributes["durable.operation.name"] === "before-callback" &&
            s.attributes["durable.operation.type"] === "STEP" &&
            s.attributes["durable.operation.attempt"] === undefined,
        );
        expect(beforeCallbackOp).toBeDefined();

        const beforeCallbackAttempt = spans.find(
          (s) =>
            s.parentSpanId === beforeCallbackOp!.spanId &&
            s.attributes["durable.operation.attempt"] === 1,
        );
        expect(beforeCallbackAttempt).toBeDefined();

        // --- my-callback context span (waitForCallback wraps in child context) ---
        const callbackCtxSpan = spans.find(
          (s) =>
            s.attributes["durable.operation.name"] === "my-callback" &&
            s.attributes["durable.operation.type"] === "CONTEXT",
        );
        expect(callbackCtxSpan).toBeDefined();

        // --- CALLBACK span ---
        const callbackSpan = spans.find(
          (s) => s.attributes["durable.operation.type"] === "CALLBACK",
        );
        expect(callbackSpan).toBeDefined();

        // --- after-callback step ---
        const afterCallbackOp = spans.find(
          (s) =>
            s.attributes["durable.operation.name"] === "after-callback" &&
            s.attributes["durable.operation.type"] === "STEP" &&
            s.attributes["durable.operation.attempt"] === undefined,
        );
        expect(afterCallbackOp).toBeDefined();

        const afterCallbackAttempt = spans.find(
          (s) =>
            s.parentSpanId === afterCallbackOp!.spanId &&
            s.attributes["durable.operation.attempt"] === 1,
        );
        expect(afterCallbackAttempt).toBeDefined();

        // --- Invocation span ---
        const invocationSpan = spans.find((s) => s.name === "invocation");
        expect(invocationSpan).toBeDefined();

        // --- Continuation spans with links ---
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
    }, 60000);
  },
});
