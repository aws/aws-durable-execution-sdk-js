import { handler } from "./otel-child-context";
import { createTests } from "../../utils/test-helper";
import { SerializedSpan } from "../otel-shared/otel-test-setup";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should produce correct parent-child span hierarchy for child context", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as {
        result: string;
        spans: SerializedSpan[];
      };

      // Assert the execution produced the expected result
      expect(result.result).toBe("inner-1-result:inner-2-result");

      const { spans } = result;

      // All spans share the same traceId
      const traceId = spans[0].traceId;
      expect(spans.every((s) => s.traceId === traceId)).toBe(true);

      // Find the child context span
      const childCtxSpan = spans.find(
        (s) =>
          s.attributes["durable.operation.name"] === "child-ctx" ||
          s.name === "child-ctx",
      );
      expect(childCtxSpan).toBeDefined();

      // Inner steps should have parentSpanId equal to child context span's spanId
      const innerSpans = spans.filter(
        (s) => s.parentSpanId === childCtxSpan!.spanId,
      );
      expect(innerSpans.length).toBeGreaterThanOrEqual(2);

      assertEventSignatures(execution);
    });
  },
});
