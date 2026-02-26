import { handler } from "./map-error-preservation";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should preserve error types and messages in map execution", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      expect(result).toBeDefined();

      // With no-retry config, map operations fail completely when any task fails
      expect(result.totalSuccess).toBe(0);
      expect(result.success).toHaveLength(0);

      // Verify we have 1 error (simplified test)
      expect(result.totalErrors).toBe(1);
      expect(result.errors).toHaveLength(1);

      // Find the callback error - this is the key test for error preservation
      const callbackError = result.errors.find(
        (error: any) => error.originalType === "CallbackError",
      );
      expect(callbackError).toBeDefined();
      expect(callbackError.type).toBe("ChildContextError");
      expect(callbackError.originalMessage).toBe(
        "Custom callback error for item 2",
      );

      // Verify map operation structure
      const mapOp = runner.getOperation("map-with-errors");
      expect(mapOp.getChildOperations()).toHaveLength(3);

      assertEventSignatures(execution);
    });

    it("should not replace errors with generic StepError in map operations", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // Ensure no errors are generic "Unknown error" or "StepError"
      result.errors.forEach((error: any) => {
        expect(error.originalMessage).not.toBe("Unknown error");
        expect(error.originalType).not.toBe("StepError");
        expect(error.originalMessage).toContain("Custom");
      });

      assertEventSignatures(execution);
    });
  },
});
