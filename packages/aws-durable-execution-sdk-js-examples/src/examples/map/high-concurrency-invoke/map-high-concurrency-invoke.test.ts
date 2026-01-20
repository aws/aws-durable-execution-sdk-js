import {
  ExecutionStatus,
  LocalDurableTestRunner,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./map-high-concurrency-invoke";
import { handler as nonDurable } from "../../non-durable/non-durable";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  localRunnerConfig: {
    checkpointDelay: 100, // 100ms delay to test checkpoint processing timing
    skipTime: false,
  },
  tests: (runner, { assertEventSignatures, functionNameMap }) => {
    it("should execute successfully with high concurrency map and invoke operations", async () => {
      if (runner instanceof LocalDurableTestRunner) {
        runner.registerFunction(
          functionNameMap.getFunctionName("non-durable"),
          nonDurable,
        );
      }

      const execution = await runner.run({
        payload: {
          functionName: functionNameMap.getFunctionName("non-durable"),
        },
      });

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      // Verify map operation structure
      const mapOperation = runner.getOperation("process-objects");
      expect(mapOperation.getChildOperations()).toHaveLength(200);

      // Verify each child operation has the expected invoke operation
      const childOps = mapOperation.getChildOperations();
      expect(childOps).toBeDefined();

      childOps!.forEach((childOp) => {
        const childInvokeOps = childOp.getChildOperations();
        expect(childInvokeOps).toHaveLength(1);
        expect(childInvokeOps![0].getStatus()).toBe(OperationStatus.SUCCEEDED);
      });

      assertEventSignatures(execution, undefined, {
        invocationCompletedDifference: 2,
      });
    });
  },
});
