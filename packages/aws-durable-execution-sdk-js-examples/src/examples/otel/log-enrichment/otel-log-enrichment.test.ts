import {
  handler,
  resetExporter,
  getSerializedSpans,
} from "./otel-log-enrichment";
import { createTests } from "../../../utils/test-helper";
import { SerializedSpan } from "../shared/otel-test-setup";

createTests({
  handler,
  tests: (runner, { assertEventSignatures, isCloud }) => {
    beforeEach(() => {
      resetExporter();
    });

    it("should enrich logs with traceId and spanId during step execution", async () => {
      const logLines: string[] = [];
      const originalWrite = process.stdout.write;
      process.stdout.write = (chunk: any, ...args: any[]) => {
        if (typeof chunk === "string") {
          logLines.push(chunk);
        } else {
          logLines.push(chunk.toString());
        }
        return originalWrite.call(process.stdout, chunk, ...args);
      };

      try {
        const execution = await runner.run();
        const result = execution.getResult() as {
          step1Result: string;
          step2Result: string;
          spans: SerializedSpan[];
        };

        expect(result.step1Result).toBe("step-1-done");
        expect(result.step2Result).toBe("step-2-done");

        const spans = isCloud ? result.spans : getSerializedSpans();

        // Single invocation, 2 steps: log-step-1 (op + attempt) +
        // log-step-2 (op + attempt) + invocation = 5 spans
        expect(spans).toHaveLength(5);

        // All spans share the same traceId
        const traceId = spans[0].traceId;
        expect(traceId).toMatch(/^[0-9a-f]{32}$/);
        expect(spans.every((s) => s.traceId === traceId)).toBe(true);

        // Assert operation spans for each step
        const logStep1Op = spans.find(
          (s) =>
            s.attributes["durable.operation.name"] === "log-step-1" &&
            s.attributes["durable.operation.type"] === "STEP" &&
            s.attributes["durable.operation.attempt"] === undefined,
        );
        expect(logStep1Op).toBeDefined();

        const logStep2Op = spans.find(
          (s) =>
            s.attributes["durable.operation.name"] === "log-step-2" &&
            s.attributes["durable.operation.type"] === "STEP" &&
            s.attributes["durable.operation.attempt"] === undefined,
        );
        expect(logStep2Op).toBeDefined();

        // Assert attempt spans are children of their respective operation spans
        const logStep1Attempt = spans.find(
          (s) =>
            s.parentSpanId === logStep1Op!.spanId &&
            s.attributes["durable.operation.attempt"] === 1,
        );
        expect(logStep1Attempt).toBeDefined();

        const logStep2Attempt = spans.find(
          (s) =>
            s.parentSpanId === logStep2Op!.spanId &&
            s.attributes["durable.operation.attempt"] === 1,
        );
        expect(logStep2Attempt).toBeDefined();

        // Both operation spans share the same parent (invocation span)
        expect(logStep1Op!.parentSpanId).toBe(logStep2Op!.parentSpanId);

        if (!isCloud) {
          // Parse JSON log lines and check for traceId/spanId
          const jsonLogs = logLines
            .filter((line) => line.trim().startsWith("{"))
            .map((line) => {
              try {
                return JSON.parse(line);
              } catch {
                return null;
              }
            })
            .filter(Boolean)
            .filter((log: any) => log.message?.includes("Executing log step"));

          expect(jsonLogs.length).toBeGreaterThanOrEqual(2);

          for (const log of jsonLogs) {
            expect(log.traceId).toMatch(/^[0-9a-f]{32}$/);
            expect(log.spanId).toMatch(/^[0-9a-f]{16}$/);
            expect(log.otelTraceSampled).toBe(true);
          }
        }

        assertEventSignatures(execution);
      } finally {
        process.stdout.write = originalWrite;
      }
    });
  },
});
