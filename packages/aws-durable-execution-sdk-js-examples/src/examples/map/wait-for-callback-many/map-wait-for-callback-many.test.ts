import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./map-wait-for-callback-many";
import { createTests } from "../../../utils/test-helper";

const ITEM_COUNT = 4;

createTests({
  handler,
  invocationType: InvocationType.Event,
  localRunnerConfig: { skipTime: false },
  tests: (runner, { assertEventSignatures }) => {
    it("4 branches, maxConcurrency 4, staggered callback completion", async () => {
      const cbs = Array.from({ length: ITEM_COUNT }, (_, i) =>
        runner.getOperation(`wait-${i}`),
      );

      const executionPromise = runner.run();

      // Register all waits concurrently before the SDK processes submitter steps.
      await Promise.all(
        cbs.map((cb) => cb.waitForData(WaitingOperationStatus.SUBMITTED)),
      );

      // Stagger callback completion: each callback fires ~80ms after the previous.
      for (let i = 0; i < cbs.length; i++) {
        await cbs[i].sendCallbackSuccess(`r-${i}`);
        await new Promise((resolve) => setTimeout(resolve, 80));
      }

      const execution = await executionPromise;

      expect(execution.getResult()).toEqual(
        Array.from({ length: ITEM_COUNT }, (_, i) => `processed:r-${i}`),
      );

      // Cloud mode may produce a different invocation count than local due to
      // differing re-invocation coalescing. The result check above validates
      // correctness; invocation count can vary.
      assertEventSignatures(execution, undefined, {
        invocationCompletedDifference: 3,
      });
    }, 60000);
  },
});
