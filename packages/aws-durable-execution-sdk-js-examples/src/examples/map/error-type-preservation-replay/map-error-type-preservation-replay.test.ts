import { handler } from "./map-error-type-preservation-replay";
import { createTests } from "../../../utils/test-helper";

/**
 * Tests for map error type preservation through ser/des round-trip.
 *
 * Map/parallel uses createBatchResultSerdes as the default serdes, which
 * uses serializeBatchError/reconstructBatchError to preserve the error
 * cause chain (type + message) through the serialize/deserialize round-trip.
 *
 * Without this, after deserialization the cause would be rebuilt as a generic
 * StepError("Unknown error") instead of preserving the original CallbackError type.
 */
createTests({
  handler,
  localRunnerConfig: {
    skipTime: true,
  },
  tests: (runner, { assertEventSignatures }) => {
    it("should preserve error cause type and message through map ser/des round-trip", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // Verify basic structure
      expect(result.beforeReplay.successCount).toBe(2);
      expect(result.beforeReplay.failureCount).toBe(1);

      // Before replay: error info captured on first run
      const errorBefore = result.beforeReplay.errorInfo[0];
      expect(errorBefore.wrapperType).toBe("ChildContextError");
      expect(errorBefore.causeType).toBe("CallbackError");
      expect(errorBefore.causeMessage).toBe("Custom callback error for item 2");

      assertEventSignatures(execution);

      // After replay: the map result was deserialized from checkpoint.
      // The cause error type must still be "CallbackError", not "StepError".
      const errorAfter = result.afterReplay.errorInfo[0];
      expect(errorAfter.wrapperType).toBe("ChildContextError");
      expect(errorAfter.causeType).toBe("CallbackError");
      expect(errorAfter.causeMessage).toBe("Custom callback error for item 2");

      // The before and after should be identical
      expect(result.afterReplay.errorInfo).toEqual(
        result.beforeReplay.errorInfo,
      );
    });
  },
});
