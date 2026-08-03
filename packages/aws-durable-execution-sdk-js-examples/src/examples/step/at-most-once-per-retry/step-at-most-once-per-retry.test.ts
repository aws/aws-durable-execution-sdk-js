import { LambdaClient } from "@aws-sdk/client-lambda";
import { CloudDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";

// This test does not use the shared `createTests` helper, and it has no
// `.history.json` event-signature snapshot, for the same reason as its sibling
// `step/interrupted-no-retry`: the scenario (a Lambda process-kill mid-step)
// cannot be reproduced by the LocalDurableTestRunner, so there is no local run
// from which to generate a deterministic history. The explicit assertions on
// the execution result verify the behavior directly.
//
// Where interrupted-no-retry exercises the AT_MOST_ONCE_PER_RETRY interrupted
// step path with `shouldRetry: false` (FAIL decision), this test exercises the
// complementary `shouldRetry: true` (RETRY decision): the SDK reschedules the
// interrupted step and it succeeds on the next attempt.

const isIntegrationTest = process.env.NODE_ENV === "integration";
const TEST_NAME = "step-at-most-once-per-retry";

if (!isIntegrationTest) {
  // Requires a real Lambda timeout; skip locally.
  it.skip(`${TEST_NAME} (cloud-only) - run with NODE_ENV=integration`, () => {});
} else {
  if (!process.env.FUNCTION_NAME_MAP) {
    throw new Error("FUNCTION_NAME_MAP is not set for integration tests");
  }
  const functionNames = JSON.parse(process.env.FUNCTION_NAME_MAP) as Record<
    string,
    string
  >;
  const functionName = functionNames[TEST_NAME];

  // Skip (rather than throw) when this example is not deployed for the current
  // job (e.g. the capacity-provider-only job, which this example doesn't opt
  // into). Mirrors the shared `createTests` helper.
  const describeCloud = functionName ? describe : describe.skip;

  describeCloud(`${TEST_NAME} (cloud)`, () => {
    const runner = new CloudDurableTestRunner({
      client: new LambdaClient({ endpoint: process.env.LAMBDA_ENDPOINT }),
      functionName,
    });

    beforeEach(() => runner.reset());

    it("should retry an interrupted AT_MOST_ONCE_PER_RETRY step and succeed on the next attempt", async () => {
      // First attempt sleeps 30s; the deployed function has Lambda Timeout=5s,
      // so the first invocation is killed mid-step, leaving the step STARTED.
      // On resume, the SDK detects the interruption and (because shouldRetry is
      // true) reschedules the step with NextAttemptDelaySeconds. The retry
      // attempt returns immediately and the execution succeeds.
      const execution = await runner.run({
        payload: { firstAttemptDurationMs: 30_000 },
      });

      const result = execution.getResult() as {
        status: string;
        result?: string;
      };

      expect(result).toBeDefined();
      expect(result.status).toBe("succeeded");
      // The step succeeds on a retry attempt (>= 2), not the interrupted first
      // attempt.
      expect(result.result).toMatch(/^completed on attempt [2-9]\d*$/);
    }, 180_000);
  });
}
