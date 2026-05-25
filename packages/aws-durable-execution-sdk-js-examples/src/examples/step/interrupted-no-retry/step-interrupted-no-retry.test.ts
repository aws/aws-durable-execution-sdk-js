import { handler } from "./step-interrupted-no-retry";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { isCloud, assertEventSignatures }) => {
    if (isCloud) {
      it("should surface a StepError with cause=StepInterruptedError when Lambda times out mid-step and shouldRetry=false", async () => {
        // Step sleeps 30s; the deployed function has Lambda Timeout=5s (configured
        // via EXAMPLE_CONFIGS in scripts/generate-sam-template.ts). The first
        // invocation is killed mid-step, leaving the step in STARTED state. On
        // replay, the SDK enters the interrupted-step + shouldRetry:false branch.
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
          message?: string;
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

        assertEventSignatures(execution);
      }, 180_000);
      return;
    }

    // Local: the LocalDurableTestRunner cannot simulate a real Lambda timeout
    // killing a step mid-execution, so the bug-reproducing scenario is cloud-only.
    // The unit-level regression test for this fix lives in the core package at
    // packages/aws-durable-execution-sdk-js/src/handlers/step-handler/step-handler.test.ts
    // (see "interrupted step with AT_MOST_ONCE_PER_RETRY"). Here we just smoke-test
    // that the handler is wired correctly with a fast-completing step.
    it("should run successfully when the step completes within the timeout (smoke test)", async () => {
      const execution = await runner.run({
        payload: { stepDurationMs: 50 },
      });

      const result = execution.getResult() as {
        status: string;
        result?: string;
      };

      expect(result.status).toBe("succeeded");
      expect(result.result).toBe("step-completed");

      assertEventSignatures(execution);
    });
  },
});
