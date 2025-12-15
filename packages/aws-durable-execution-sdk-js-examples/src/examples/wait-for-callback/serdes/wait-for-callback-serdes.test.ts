import {
  InvocationType,
  OperationStatus,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { CustomData, handler } from "./wait-for-callback-serdes";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner) => {
    it("should handle waitForCallback with custom serdes configuration", async () => {
      const executionPromise = runner.run();

      const callbackOperation = runner.getOperation("custom-serdes-callback");

      await callbackOperation.waitForData(WaitingOperationStatus.STARTED);

      // Serialize the data using custom serdes for sending
      await callbackOperation.sendCallbackSuccess(
        JSON.stringify({
          id: 42,
          message: "Hello Custom Serdes",
          timestamp: "2025-06-15T12:30:45Z",
          metadata: {
            version: "2.0.0",
            processed: false,
          },
        }),
      );

      const result = await executionPromise;

      expect(result.getResult()).toEqual(
        JSON.parse(
          // the result will always get stringified since it's the lambda response
          JSON.stringify({
            receivedData: {
              id: 42,
              message: "Hello Custom Serdes",
              timestamp: new Date("2025-06-15T12:30:45Z"),
              metadata: {
                version: "2.0.0",
                processed: true,
              },
              circular: undefined,
            } satisfies CustomData,
            isDateBeforeReplay: true,
            isDateAfterReplay: true,
            isSerdesProcessedBefore: true,
            isSerdesProcessedAfter: true,
            hasCircularReference: true,
          }),
        ),
      );

      // Should have completed operations with successful callback
      const completedOperations = result.getOperations({
        status: OperationStatus.SUCCEEDED,
      });
      expect(completedOperations.length).toBeGreaterThan(0);
    });
  },
});
