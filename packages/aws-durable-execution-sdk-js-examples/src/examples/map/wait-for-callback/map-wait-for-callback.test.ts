import {
  InvocationType,
  OperationStatus,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./map-wait-for-callback";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should progress to next step immediately after all map callbacks signal (issue #510)", async () => {
      const items = [0, 1];
      const executionPromise = runner.run({ payload: { items } });

      const mapOp = runner.getOperation("map-callbacks");
      await mapOp.waitForData(WaitingOperationStatus.STARTED);

      // Each map branch has a waitForCallback child named "branch-callback".
      const branches = mapOp.getChildOperations();
      expect(branches).toHaveLength(items.length);

      await Promise.all(
        branches!.map(async (branch, i) => {
          const callbackOp = branch
            .getChildOperations()!
            .find((op) => op.isWaitForCallback())!;
          await callbackOp.waitForData(WaitingOperationStatus.SUBMITTED);
          await callbackOp.sendCallbackSuccess(`result-${i}`);
        }),
      );

      const execution = await executionPromise;

      expect(execution.getResult()).toEqual({
        callbackResults: ["result-0", "result-1"],
        afterMap: "processed 2 items",
      });

      // Regression guard: after-map step ran (did not wedge waiting for an unrelated timer).
      expect(runner.getOperation("after-map").getStatus()).toBe(
        OperationStatus.SUCCEEDED,
      );

      assertEventSignatures(execution, "success");
    });
  },
});
