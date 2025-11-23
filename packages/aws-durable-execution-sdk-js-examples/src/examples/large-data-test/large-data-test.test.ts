import {
  OperationType,
  OperationStatus,
  ExecutionStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./large-data-test";
import { createTests } from "../../utils/test-helper";

createTests({
  name: "large-data-test",
  functionName: "large-data-test",
  handler,
  tests: (runner) => {
    it("should execute steps correctly followed by a wait", async () => {
      const execution = await runner.run();

      // Verify the handler succeeds
      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      const operations = execution.getOperations();
      expect(operations).toHaveLength(101);

      // Verify the initial operations are steps with correct data
      for (let i = 0; i < 100; i++) {
        const stepOperation = runner.getOperationByIndex(i);
        expect(stepOperation.getType()).toBe(OperationType.STEP);
        expect(stepOperation.getStatus()).toBe(OperationStatus.SUCCEEDED);

        // Verify step result contains expected data structure
        const stepResult = stepOperation.getStepDetails()?.result as any;
        expect(stepResult).toMatchObject({
          largeData: expect.any(String),
        });

        const stepSize = Buffer.byteLength(stepResult.largeData, "utf-8");

        expect(stepSize).toBe(150600);
      }

      // Verify the last operation is a wait
      const waitOperation = runner.getOperationByIndex(-1);
      expect(waitOperation.getType()).toBe(OperationType.WAIT);
      expect(waitOperation.getStatus()).toBe(OperationStatus.SUCCEEDED);
      expect(waitOperation.getWaitDetails()?.waitSeconds).toBe(5);
    }, 120000);
  },
});
