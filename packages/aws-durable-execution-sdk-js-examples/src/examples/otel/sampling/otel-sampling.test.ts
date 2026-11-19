import { context, propagation, trace } from "@opentelemetry/api";
import {
  handler,
  tracerProvider,
  type SamplingObservation,
} from "./otel-sampling";
import { createTests } from "../../../utils/test-helper";

const sampledTraceId = "5759e988bd862e3fe1be46a994272793";
const sampledHeader =
  "Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1";
let invocations = 0;

afterAll(async () => {
  await tracerProvider?.shutdown();
  trace.disable();
  context.disable();
  propagation.disable();
});

createTests<{ first: SamplingObservation; resumed: SamplingObservation }>({
  // The local runner uses a known sampled parent; cloud execution uses the
  // real Lambda carrier and must still obey the same explicit AlwaysOff policy.
  handler: (event, lambdaContext) => {
    const runtimeContext = {
      ...lambdaContext,
      xRayTraceId: sampledHeader,
      // The local runner otherwise reuses one request ID across invocations.
      awsRequestId: `sampling-request-${++invocations}`,
      getRemainingTimeInMillis: () => 10_000,
    };
    return handler(event, runtimeContext);
  },
  tests: (runner, { isCloud, assertEventSignatures }) => {
    it("keeps both invocations unsampled and replays the completed observation", async () => {
      const execution = await runner.run();
      expect(execution.getStatus()).toBe("SUCCEEDED");
      const { first, resumed } = execution.getResult()!;
      expect(first.sampled).toBe(false);
      expect(resumed.sampled).toBe(false);
      expect(first.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(resumed.traceId).toBe(first.traceId);
      if (!isCloud) {
        expect(first.traceId).toBe(sampledTraceId);
        expect(invocations).toBeGreaterThanOrEqual(2);
      }
      // Rerunning the first step on replay would capture the resumed request ID.
      expect(resumed.requestId).not.toBe(first.requestId);
      expect(execution.getOperations()).toHaveLength(3);
      expect(
        runner.getOperation("observe-initial-sampling").getStepDetails()
          ?.result,
      ).toEqual(first);
      expect(
        runner.getOperation("observe-resumed-sampling").getStepDetails()
          ?.result,
      ).toEqual(resumed);
      assertEventSignatures(execution, undefined, {
        invocationCompletedDifference: 1,
      });
    }, 120000);
  },
});
