import { LambdaClient } from "@aws-sdk/client-lambda";
import { CloudDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";

// This test does not use the shared `createTests` helper because it does not
// need an event-signature snapshot — the explicit assertions on the execution
// result already verify the bug-fix contract directly. `step-with-retry.test.ts`
// is precedent for not using `createTests`.
//
// The bug-reproducing scenario (Lambda process-kill mid-step) cannot be
// simulated by the LocalDurableTestRunner, so this is cloud-only. The
// unit-level regression test for this fix lives in the core package at
// packages/aws-durable-execution-sdk-js/src/handlers/step-handler/step-handler.test.ts
// (see "interrupted step with AT_MOST_ONCE_PER_RETRY").

const isIntegrationTest = process.env.NODE_ENV === "integration";
const TEST_NAME = "step-interrupted-no-retry";

if (!isIntegrationTest) {
  // Bug-reproducing scenario requires a real Lambda timeout; skip locally.
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
  if (!functionName) {
    throw new Error(
      `Function name ${TEST_NAME} not found in FUNCTION_NAME_MAP`,
    );
  }

  describe(`${TEST_NAME} (cloud)`, () => {
    const runner = new CloudDurableTestRunner({
      client: new LambdaClient({ endpoint: process.env.LAMBDA_ENDPOINT }),
      functionName,
    });

    beforeEach(() => runner.reset());

    it("should surface a StepError with cause=StepInterruptedError when Lambda times out mid-step and shouldRetry=false", async () => {
      // Step sleeps 30s; the deployed function has Lambda Timeout=5s
      // (configured via EXAMPLE_CONFIGS in scripts/generate-sam-template.ts).
      // The first invocation is killed mid-step, leaving the step in STARTED
      // state. On replay, the SDK enters the interrupted-step + shouldRetry:
      // false branch.
      //
      // Regression for https://github.com/aws/aws-durable-execution-sdk-js/pull/569
      // (issue #529): without the metadata fix in step-handler.ts, this throws
      // "metadata required on first call" before the user-visible error is
      // produced, crashing the function on replay.
      const execution = await runner.run({
        payload: { stepDurationMs: 30_000 },
      });

      const result = execution.getResult() as {
        status: string;
        errorType?: string;
        errorName?: string;
        causeName?: string;
      };

      expect(result).toBeDefined();
      expect(result.status).toBe("failed");

      // Public contract: handlers receive a DurableOperationError subclass.
      // The thrown error must be StepError, NOT StepInterruptedError.
      expect(result.errorType).toBe("StepError");
      expect(result.errorName).toBe("StepError");

      // The cause chain preserves the original interruption signal so users
      // can detect it via err.cause?.name === "StepInterruptedError".
      expect(result.causeName).toBe("StepInterruptedError");
    }, 180_000);
  });
}
