import { handler } from "./run-in-child-context-serdes-virtual";
import { createTests } from "../../../utils/test-helper";
import {
  OperationType,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";

/**
 * Virtual context path: runInChildContext should apply the serdes round-trip on
 * first run even though virtual contexts are never checkpointed. With
 * uppercaseSerdes the result must come back UPPERCASE ("HELLO").
 */
createTests({
  handler,
  localRunnerConfig: {
    skipTime: true,
  },
  tests: (runner, { assertEventSignatures }) => {
    it("should apply ser/des round-trip for virtual contexts on first run", async () => {
      const execution = await runner.run({
        payload: "hello",
      });

      const result = execution.getResult() as {
        capturedOnFirstRun: string;
      };

      // The capture step runs in the parent context and should succeed.
      const captureOp = runner.getOperation("capture-virtual-result");
      expect(captureOp.getType()).toBe(OperationType.STEP);
      expect(captureOp.getStatus()).toBe(OperationStatus.SUCCEEDED);

      // At least 2 invocations (first run + replay after the wait).
      expect(execution.getInvocations().length).toBeGreaterThanOrEqual(2);

      assertEventSignatures(execution);

      // The serdes round-trip MUST have been applied: serialize uppercased the
      // value, so the virtual child context returns "HELLO".
      expect(result.capturedOnFirstRun).toBe("HELLO");
    });
  },
});
