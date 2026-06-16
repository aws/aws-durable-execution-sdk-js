import { handler } from "./run-in-child-context-serdes";
import { createTests } from "../../../utils/test-helper";
import {
  OperationType,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";

/**
 * Tests for child context ser/des round-trip behavior.
 *
 * Small payload path: runInChildContext should return deserialize(serialize(result))
 * on first run so it matches what replay returns (deserialized from checkpoint).
 */
createTests({
  handler,
  localRunnerConfig: {
    skipTime: true,
  },
  tests: (runner, { assertEventSignatures }) => {
    it("should apply ser/des round-trip for small payloads on first run", async () => {
      const execution = await runner.run({
        payload: "hello",
      });

      const result = execution.getResult() as {
        capturedOnFirstRun: string;
      };

      // Verify operations succeeded
      const childOp = runner.getOperation("serdes-child");
      expect(childOp.getType()).toBe(OperationType.CONTEXT);
      expect(childOp.getStatus()).toBe(OperationStatus.SUCCEEDED);

      const captureOp = runner.getOperation("capture-result");
      expect(captureOp.getType()).toBe(OperationType.STEP);
      expect(captureOp.getStatus()).toBe(OperationStatus.SUCCEEDED);

      // Verify at least 2 invocations (first run + replay after wait)
      expect(execution.getInvocations().length).toBeGreaterThanOrEqual(2);

      assertEventSignatures(execution);

      // On first run, runInChildContext must return deserialize(serialize(result))
      // so that the caller sees the same value as on replay.
      expect(result.capturedOnFirstRun).toBe("HELLO");
    });
  },
});
