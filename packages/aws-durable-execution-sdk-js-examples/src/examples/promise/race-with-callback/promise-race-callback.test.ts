import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./promise-race-callback";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should race callbacks and return first resolved result", async () => {
      const executionPromise = runner.run();

      // Get the first callback operation and resolve it
      const callback1 = runner.getOperationByIndex(0);
      await callback1.waitForData(WaitingOperationStatus.STARTED);
      await callback1.sendCallbackSuccess("callback-1-result");

      // Wait for execution to complete
      const execution = await executionPromise;

      // Verify the execution succeeded
      expect(execution.getStatus()).toBe("SUCCEEDED");

      // The result should be from the resolved callback
      const result = execution.getResult() as string;
      expect(result).toBe("callback-1-result");

      // Call assertEventSignatures to satisfy the test framework
      // Note: This will use the generated history file for callback-based events
      assertEventSignatures(execution);
    }, 10000);
  },
});
