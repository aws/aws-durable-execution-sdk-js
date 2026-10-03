import { deriveTraceIdFromXRayRoot } from "@aws/durable-execution-sdk-js-otel";
import { handler, type CarrierObservation } from "./otel-runtime-carrier";
import { createTests } from "../../../utils/test-helper";

createTests<{ first: CarrierObservation; resumed: CarrierObservation }>({
  handler,
  tests: (runner, { isCloud, functionNameMap, assertEventSignatures }) => {
    it("forwards the real invocation carrier on initial execution and resume", async () => {
      const result = await runner.run();
      expect(result.getStatus()).toBe("SUCCEEDED");
      const captured = result.getResult();
      expect(captured).toBeDefined();
      if (!captured) throw new Error("Carrier observations are missing");
      const { first, resumed } = captured;
      const target = functionNameMap.getFunctionName("otel-runtime-carrier");
      const requiresRuntimeCarrier =
        isCloud && target.includes("-CapacityProvider:");
      if (isCloud) expect(resumed.requestId).not.toBe(first.requestId);
      for (const captured of [first, resumed]) {
        expect(captured.forwardedHeader).toBe(captured.runtimeHeader);
        if (requiresRuntimeCarrier) {
          expect(captured.functionName).toContain("-CapacityProvider");
          expect(captured.runtimeHeader).toEqual(expect.any(String));
          expect(captured.runtimeHeader).not.toBe("");
        }
        if (captured.runtimeHeader) {
          const fields = Object.fromEntries(
            captured.runtimeHeader
              .split(";")
              .map((field) => field.trim().split("=")),
          );
          expect(captured.extracted?.traceId).toBe(
            deriveTraceIdFromXRayRoot(fields.Root),
          );
          expect(captured.traceId).toBe(captured.extracted?.traceId);
          if (fields.Parent)
            expect(captured.extracted?.parentSpanId).toBe(
              fields.Parent.toLowerCase(),
            );
          if (fields.Sampled === "0" || fields.Sampled === "1")
            expect(captured.extracted?.sampling).toBe(
              fields.Sampled === "0" ? "NOT_SAMPLED" : "SAMPLED",
            );
        }
      }
      // Both runtime headers must keep one durable execution on one trace.
      expect(resumed.traceId).toBe(first.traceId);
      expect(result.getOperations()).toHaveLength(3);
      expect(
        runner.getOperation("capture-initial-carrier").getStepDetails()?.result,
      ).toEqual(first);
      expect(
        runner.getOperation("capture-resumed-carrier").getStepDetails()?.result,
      ).toEqual(resumed);
      assertEventSignatures(result, undefined, {
        invocationCompletedDifference: 1,
      });
    }, 120000);
  },
});
