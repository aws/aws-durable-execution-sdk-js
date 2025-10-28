import {
  OperationType,
  OperationStatus,
  ExecutionStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "../retry-exhaustion";
import { createTests } from "./shared/test-helper";

createTests({
  name: "retry-exhaustion test",
  functionName: "retry-exhaustion",
  handler,
  tests: (runner) => {
    it("should handle steps with retry and failure until exhaustion", async () => {
      // Get operation for the retry call
      const retriesOperation = runner.getOperation("retries");

      const result = await runner.run();

      // Verify final error state after retry exhaustion
      const error = result.getError();
      expect(error).toMatchObject({
        errorType: "Error",
        errorMessage: "There was an error",
        stackTrace: expect.any(Array),
      });
      expect(error.stackTrace?.length).toBeGreaterThan(1);
      error.stackTrace?.forEach((value) => {
        expect(typeof value).toBe("string");
      });

      // Verify operations were tracked
      const completedOperations = result.getOperations();
      expect(completedOperations.length).toEqual(1);

      // Verify operation details
      expect(retriesOperation.getType()).toBe(OperationType.STEP);
      expect(retriesOperation.getStatus()).toBe(OperationStatus.FAILED);

      // Verify retries - should exhaust all attempts
      const stepDetails = retriesOperation.getStepDetails();
      expect(stepDetails).toBeDefined();
      expect(stepDetails?.attempt).toEqual(6);
      expect(stepDetails?.error).toBeDefined();

      expect(result.getStatus()).toBe(ExecutionStatus.FAILED);
    });
  },
});
