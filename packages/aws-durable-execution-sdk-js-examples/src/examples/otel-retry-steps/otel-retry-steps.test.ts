import { handler } from "./otel-retry-steps";
import { createTests } from "../../utils/test-helper";
import { SerializedSpan } from "../otel-shared/otel-test-setup";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should produce attempt spans with error status on failures", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as {
        result: string;
        spans: SerializedSpan[];
      };

      // Assert result
      expect(result.result).toBe("success-on-attempt-3");

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

      // First two attempts should have ERROR status (code 2)
      expect(sorted[0].status.code).toBe(2); // ERROR
      expect(sorted[0].status.message).toBeDefined();
      expect(sorted[1].status.code).toBe(2); // ERROR
      expect(sorted[1].status.message).toBeDefined();

      // Third attempt should have UNSET status (code 0)
      expect(sorted[2].status.code).toBe(0); // UNSET

      // Verify attempt numbers
      expect(sorted[0].attributes["durable.operation.attempt"]).toBe(1);
      expect(sorted[1].attributes["durable.operation.attempt"]).toBe(2);
      expect(sorted[2].attributes["durable.operation.attempt"]).toBe(3);

      assertEventSignatures(execution);
    });
  },
});
