import { handler } from "./run-in-child-context-serdes-large-payload";
import { createTests } from "../../../utils/test-helper";
import {
  OperationType,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";

/**
 * Large payload (ReplayChildren) path: runInChildContext should apply the
 * serdes round-trip on first run so the caller sees the same value replay
 * returns. With uppercaseSerdes the 300KB result must come back UPPERCASE.
 */
createTests({
  handler,
  localRunnerConfig: {
    skipTime: true,
  },
  tests: (runner, { assertEventSignatures }) => {
    it("should apply ser/des round-trip for large payloads on first run", async () => {
      const execution = await runner.run({});

      const result = execution.getResult() as {
        capturedOnFirstRun: {
          prefix: string;
          length: number;
          isUppercase: boolean;
        };
      };

      // The child context operation should have completed successfully.
      const childOp = runner.getOperation("large-serdes-child");
      expect(childOp.getType()).toBe(OperationType.CONTEXT);
      expect(childOp.getStatus()).toBe(OperationStatus.SUCCEEDED);

      // At least 2 invocations (first run + replay after the wait).
      expect(execution.getInvocations().length).toBeGreaterThanOrEqual(2);

      assertEventSignatures(execution);

      // The serdes round-trip MUST have been applied: serialize uppercased the
      // value, so the returned 300KB payload is all uppercase.
      expect(result.capturedOnFirstRun.length).toBe(300 * 1024);
      expect(result.capturedOnFirstRun.prefix).toBe("XXXXXXXXXX");
      expect(result.capturedOnFirstRun.isUppercase).toBe(true);
    });
  },
});
