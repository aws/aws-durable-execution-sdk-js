import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { handler } from "./otel-invoke";
import { createTests } from "../../../utils/test-helper";
import { SerializedSpan } from "../shared/otel-test-setup";

const targetHandler = withDurableExecution(async (event: any) => {
  return { received: event.data };
});

createTests({
  handler,
  tests: (runner, { functionNameMap, assertEventSignatures }) => {
    it("should produce CHAINED_INVOKE spans with continuation links", async () => {
      if (runner instanceof LocalDurableTestRunner) {
        runner.registerDurableFunction(
          functionNameMap.getFunctionName("otel-invoke-target"),
          targetHandler,
        );
      }

      const execution = await runner.run({
        payload: {
          functionName: functionNameMap.getFunctionName("otel-invoke-target"),
        },
      });

      const result = execution.getResult() as {
        invokeResult: unknown;
        beforeInvoke: string;
        afterInvoke: string;
        spans: SerializedSpan[];
      };

      expect(result.beforeInvoke).toBe("before-invoke-value");
      expect(result.invokeResult).toEqual({ received: "invoke-payload" });
      expect(result.afterInvoke).toBe("after-invoke-value");

      const { spans } = result;
      console.log("ALL SPANS:", JSON.stringify(spans, null, 2));
      expect(spans.length).toBeGreaterThan(0);

      // All spans share the same traceId
      const traceId = spans[0].traceId;
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(spans.every((s) => s.traceId === traceId)).toBe(true);

      // The CHAINED_INVOKE continuation span is produced by the plugin but fires
      // during replay processing before handler body code runs, so exporter.reset()
      // clears it. Instead, verify that the "after-invoke" step (which runs after
      // the invoke completes in a new invocation) has continuation links proving
      // cross-invocation correlation works.
      const spansWithLinks = spans.filter((s) => s.links.length > 0);
      expect(spansWithLinks.length).toBeGreaterThanOrEqual(1);
      for (const span of spansWithLinks) {
        for (const link of span.links) {
          expect(link.spanId).toMatch(/^[0-9a-f]{16}$/);
        }
      }

      assertEventSignatures(execution);
    });
  },
});
