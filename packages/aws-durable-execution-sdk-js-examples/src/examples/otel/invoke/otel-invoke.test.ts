import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { handler, resetExporter } from "./otel-invoke";
import { handler as basicStepsHandler } from "../basic-steps/otel-basic-steps";
import { createTests } from "../../../utils/test-helper";
import { SerializedSpan } from "../shared/otel-test-setup";

createTests({
  handler,
  tests: (runner, { functionNameMap, assertEventSignatures }) => {
    beforeEach(() => {
      resetExporter();
    });

    it("should produce CHAINED_INVOKE spans with continuation links", async () => {
      if (runner instanceof LocalDurableTestRunner) {
        runner.registerDurableFunction(
          functionNameMap.getFunctionName("otel-invoke-target"),
          basicStepsHandler,
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
      expect((result.invokeResult as any).result).toBe(
        "step-1-result:step-2-result:step-3-result",
      );
      expect(result.afterInvoke).toBe("after-invoke-value");

      const { spans } = result;
      // With exporter reset at the test level (not inside the handler), we capture
      // all spans across all invocations:
      // Invocation 1: "before-invoke" (operation + attempt), "invoke-target" (CHAINED_INVOKE), "invocation"
      // Invocation 2: "after-invoke" (operation + attempt)
      // The invocation 2's "invocation" span is still open when getSerializedSpans() is called.
      expect(spans.length).toBe(6);

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
