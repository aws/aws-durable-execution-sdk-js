import { handler } from "./otel-wait-and-resume";
import { createTests } from "../../utils/test-helper";
import { SerializedSpan } from "../otel-shared/otel-test-setup";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should produce continuation spans with links after wait and resume", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as {
        beforeWait: string;
        afterWait: string;
        spans: SerializedSpan[];
      };

      // Assert result values
      expect(result.beforeWait).toBe("before-wait-value");
      expect(result.afterWait).toBe("after-wait-value");

      const { spans } = result;

      // All spans share the same traceId (deterministic from execution ARN)
      const traceId = spans[0].traceId;
      expect(spans.every((s) => s.traceId === traceId)).toBe(true);

      // Look for continuation spans (spans with links)
      const spansWithLinks = spans.filter((s) => s.links.length > 0);
      // After a wait and resume, there should be continuation spans with links
      // to deterministic span IDs from the prior invocation
      expect(spansWithLinks.length).toBeGreaterThanOrEqual(1);

      // Verify link span IDs are 16-char hex strings (deterministic span IDs)
      for (const span of spansWithLinks) {
        for (const link of span.links) {
          expect(link.spanId).toMatch(/^[0-9a-f]{16}$/);
          expect(link.traceId).toMatch(/^[0-9a-f]{32}$/);
        }
      }

      assertEventSignatures(execution);
    });
  },
});
