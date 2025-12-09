import {
  InvocationType,
  OperationStatus,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./wait-for-callback-child-context";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner) => {
    it("should handle waitForCallback within child contexts", async () => {
      // Get operations - parent callback, child context, child wait, child callback
      const parentCallbackOp = runner.getOperation("parent-callback-op");
      const childContextOp = runner.getOperation("child-context-with-callback");
      const childCallbackOp = runner.getOperation("child-callback-op");

      const executionPromise = runner.run({
        payload: { test: "child-context-callbacks" },
      });

      // Wait for parent callback to start
      await parentCallbackOp.waitForData(WaitingOperationStatus.STARTED);
      const parentCallbackResult = JSON.stringify({
        parentData: "parent-completed",
      });
      console.log("parent callback op", parentCallbackOp.getOperationData());
      await parentCallbackOp.sendCallbackSuccess(parentCallbackResult);

      // Wait for child callback to start
      await childCallbackOp.waitForData(WaitingOperationStatus.STARTED);
      const childCallbackResult = JSON.stringify({ childData: 42 });
      console.log("child callback op", childCallbackOp.getOperationData());
      await childCallbackOp.sendCallbackSuccess(childCallbackResult);

      const result = await executionPromise;

      expect(result.getResult()).toEqual({
        parentResult: parentCallbackResult,
        childContextResult: {
          childResult: childCallbackResult,
          childProcessed: true,
        },
      });

      // Verify child operations are accessible
      const childOperations = childContextOp.getChildOperations();
      expect(childOperations).toHaveLength(2); // wait + waitForCallback

      const completedOperations = result.getOperations({
        status: OperationStatus.SUCCEEDED,
      });
      expect(completedOperations.length).toBe(8);
    });
  },
});
