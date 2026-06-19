import { handler } from "./otel-log-enrichment";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures, isCloud }) => {
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
        const result = execution.getResult() as any;

        expect(result.step1Result).toBe("step-1-done");
        expect(result.step2Result).toBe("step-2-done");

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
          }
        }

        assertEventSignatures(execution);
      } finally {
        process.stdout.write = originalWrite;
      }
    });
  },
});
