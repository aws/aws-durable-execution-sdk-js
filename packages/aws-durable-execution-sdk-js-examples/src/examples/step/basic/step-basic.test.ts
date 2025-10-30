import {
  OperationType,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./step-basic";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "step-basic test",
  functionName: "step-basic",
  handler,
  tests: (runner) => {
    it("should execute step and return correct result with detailed verification", async () => {
      const execution = await runner.run();

      // Get step operation
      const stepOperation = runner.getOperationByIndex(0);

      expect(execution.getOperations()).toHaveLength(1);
      expect(execution.getResult()).toStrictEqual("step completed");

      // Verify operation details
      expect(stepOperation.getType()).toBe(OperationType.STEP);
      expect(stepOperation.getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(stepOperation.getStepDetails()).toBeDefined();
      expect(stepOperation.getStepDetails()?.result).toEqual("step completed");
    });
  },
});
