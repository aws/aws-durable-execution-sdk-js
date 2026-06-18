import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./otel-callback";
import { createTests } from "../../../utils/test-helper";
import { SerializedSpan } from "../shared/otel-test-setup";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
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
      };

      expect(result.beforeCallback).toBe("before-callback-value");
      expect(result.callbackResult).toBe("callback-value");
      expect(result.afterCallback).toBe("after-callback-value");

      const { spans } = result;
      expect(spans.length).toBeGreaterThan(0);

      // All spans share the same traceId
      const traceId = spans[0].traceId;
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(spans.every((s) => s.traceId === traceId)).toBe(true);

      // Assert callback span exists (waitForCallback is wrapped in a child context,
      // so the operation type is "CONTEXT" with the callback name)
      const callbackSpan = spans.find(
        (s) =>
          s.attributes["durable.operation.name"] === "my-callback" &&
          s.attributes["durable.operation.type"] === "CONTEXT",
      );
      expect(callbackSpan).toBeDefined();

      // Continuation spans with links
      const spansWithLinks = spans.filter((s) => s.links.length > 0);
      expect(spansWithLinks.length).toBeGreaterThanOrEqual(1);
      for (const span of spansWithLinks) {
        for (const link of span.links) {
          expect(link.spanId).toMatch(/^[0-9a-f]{16}$/);
        }
      }

      assertEventSignatures(execution);
    }, 30000);
  },
});
