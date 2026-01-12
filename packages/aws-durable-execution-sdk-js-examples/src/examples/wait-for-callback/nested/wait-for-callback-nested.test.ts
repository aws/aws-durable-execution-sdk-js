import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./wait-for-callback-nested";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should handle nested waitForCallback operations in child contexts", async () => {
      // Get operations - outer callback, outer context, inner callback, inner context, deep wait, nested callback
      const outerCallbackOp = runner.getOperation("outer-callback-op");
      const outerContextOp = runner.getOperation("outer-child-context");
      const innerCallbackOp = runner.getOperation("inner-callback-op");
      const innerContextOp = runner.getOperation("inner-child-context");
      const nestedCallbackOp = runner.getOperation("nested-callback-op");

      const executionPromise = runner.run();

      // Complete callbacks in sequence
      await outerCallbackOp.waitForData(WaitingOperationStatus.SUBMITTED);
      const outerCallbackResult = JSON.stringify({ level: "outer-completed" });
      await outerCallbackOp.sendCallbackSuccess(outerCallbackResult);

      await innerCallbackOp.waitForData(WaitingOperationStatus.SUBMITTED);
      const innerCallbackResult = JSON.stringify({ level: "inner-completed" });
      await innerCallbackOp.sendCallbackSuccess(innerCallbackResult);

      await nestedCallbackOp.waitForData(WaitingOperationStatus.SUBMITTED);
      const nestedCallbackResult = JSON.stringify({
        level: "nested-completed",
      });
      await nestedCallbackOp.sendCallbackSuccess(nestedCallbackResult);

      const result = await executionPromise;

      expect(result.getResult()).toEqual({
        outerCallback: outerCallbackResult,
        nestedResults: {
          innerCallback: innerCallbackResult,
          deepNested: {
            nestedCallback: nestedCallbackResult,
            deepLevel: "inner-child",
          },
          level: "outer-child",
        },
      });

      // Verify child operations hierarchy
      const outerChildren = outerContextOp.getChildOperations();
      expect(outerChildren).toHaveLength(2); // inner callback + inner context

      const innerChildren = innerContextOp.getChildOperations();
      expect(innerChildren).toHaveLength(2); // deep wait + nested callback

      // Should have tracked all operations
      const completedOperations = result.getOperations();
      expect(completedOperations.length).toBe(12);

      assertEventSignatures(result);
    });
  },
});
