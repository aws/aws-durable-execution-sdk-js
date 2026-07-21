import { XRayClient } from "@aws-sdk/client-xray";
import {
  handler,
  resetExporter,
  getSerializedSpans,
} from "./otel-wait-and-resume";
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

    it("should produce continuation spans with links after wait and resume", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as {
        beforeWait: string;
        afterWait: string;
        spans: SerializedSpan[];
        xRayHeader: string | undefined;
      };

      // Assert result values
      expect(result.beforeWait).toBe("before-wait-value");
      expect(result.afterWait).toBe("after-wait-value");

      if (isCloud) {
        // Cloud mode: assert spans via X-Ray
        expect(result.xRayHeader).toBeDefined();
        const traceId = extractTraceIdFromXRayHeader(result.xRayHeader!);
        expect(traceId).toBeDefined();

        const xrayClient = new XRayClient({});
        const trace = await fetchXRayTrace(xrayClient, traceId!, {
          delayMs: 30000,
        });

        assertSpanNames(trace, ["before-wait", "short-wait", "after-wait"]);

        // Assert span attributes
        assertSpanAttributes(trace, "before-wait", {
          "durable.operation.type": "STEP",
        });
        assertSpanAttributes(trace, "short-wait", {
          "durable.operation.type": "WAIT",
        });
        assertSpanAttributes(trace, "after-wait", {
          "durable.operation.type": "STEP",
        });
      } else {
        // Local mode: assert spans via InMemorySpanExporter
        const spans = getSerializedSpans();
        // All spans across both invocations: before-wait (op + attempt),
        // short-wait, invocation, invocation (2nd), after-wait (op + attempt) + Workflow = 8 spans
        expect(spans).toHaveLength(8);

        // All spans share the same traceId (deterministic from execution ARN)
        const traceId = spans[0].traceId;
        expect(traceId).toMatch(/^[0-9a-f]{32}$/);
        expect(spans.every((s) => s.traceId === traceId)).toBe(true);

        // --- before-wait step ---
        const beforeWaitOp = spans.find(
          (s) =>
            s.attributes["durable.operation.name"] === "before-wait" &&
            s.attributes["durable.operation.type"] === "STEP" &&
            s.attributes["durable.operation.attempt"] === undefined,
        );
        expect(beforeWaitOp).toBeDefined();

        const beforeWaitAttempt = spans.find(
          (s) =>
            s.parentSpanId === beforeWaitOp!.spanId &&
            s.attributes["durable.operation.attempt"] === 1,
        );
        expect(beforeWaitAttempt).toBeDefined();

        // --- short-wait span ---
        const waitSpan = spans.find(
          (s) =>
            s.attributes["durable.operation.name"] === "short-wait" &&
            s.attributes["durable.operation.type"] === "WAIT",
        );
        expect(waitSpan).toBeDefined();

        // --- after-wait step ---
        const afterWaitOp = spans.find(
          (s) =>
            s.attributes["durable.operation.name"] === "after-wait" &&
            s.attributes["durable.operation.type"] === "STEP" &&
            s.attributes["durable.operation.attempt"] === undefined,
        );
        expect(afterWaitOp).toBeDefined();

        const afterWaitAttempt = spans.find(
          (s) =>
            s.parentSpanId === afterWaitOp!.spanId &&
            s.attributes["durable.operation.attempt"] === 1,
        );
        expect(afterWaitAttempt).toBeDefined();

        // --- Invocation span ---
        const invocationSpan = spans.find((s) => s.name === "invocation");
        expect(invocationSpan).toBeDefined();

        // --- Continuation spans with links (cross-invocation correlation) ---
        const spansWithLinks = spans.filter((s) => s.links.length > 0);
        expect(spansWithLinks.length).toBeGreaterThanOrEqual(1);

        // Verify link span IDs are 16-char hex strings (deterministic span IDs)
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
