import { handler } from "./otel-retry-steps";
import { createTests } from "../../../utils/test-helper";
import { SerializedSpan } from "../shared/otel-test-setup";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should produce attempt spans with error status after exhausting retries", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as {
        failed: boolean;
        errorMessage: string;
        spans: SerializedSpan[];
      };

      // The step should have failed after exhausting retries
      expect(result.failed).toBe(true);
      expect(result.errorMessage).toBe("always fails");

      const { spans } = result;

      // Find attempt spans (they have durable.operation.attempt attribute)
      const attemptSpans = spans.filter(
        (s) => s.attributes["durable.operation.attempt"] !== undefined,
      );
      expect(attemptSpans).toHaveLength(3);

      // Sort by attempt number
      const sorted = attemptSpans.sort(
        (a, b) =>
          (a.attributes["durable.operation.attempt"] as number) -
          (b.attributes["durable.operation.attempt"] as number),
      );

      // All attempts should have ERROR status (code 2) since every attempt fails
      for (const span of sorted) {
        expect(span.status.code).toBe(2); // ERROR
        expect(span.status.message).toBeDefined();
      }

      // Verify attempt numbers
      expect(sorted[0].attributes["durable.operation.attempt"]).toBe(1);
      expect(sorted[1].attributes["durable.operation.attempt"]).toBe(2);
      expect(sorted[2].attributes["durable.operation.attempt"]).toBe(3);

      assertEventSignatures(execution);
    });
  },
});
