import {
  InvocationType,
  OperationStatus,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "../wait-for-callback-serdes";
import { createTests } from "./shared/test-helper";

// Define CustomData type to match handler
interface CustomData {
  id: number;
  message: string;
  timestamp: Date;
  metadata: {
    version: string;
    processed: boolean;
  };
}

// Custom serdes from handler (needed for test)
const customSerdes = {
  serialize: async (
    data: CustomData | undefined,
  ): Promise<string | undefined> => {
    if (data === undefined) return Promise.resolve(undefined);
    return Promise.resolve(
      JSON.stringify({
        ...data,
        timestamp: data.timestamp.toISOString(),
        _serializedBy: "custom-serdes-v1",
      }),
    );
  },
};

createTests({
  name: "wait-for-callback-serdes test",
  functionName: "wait-for-callback-serdes",
  handler,
  invocationType: InvocationType.Event,
  tests: (runner) => {
    it("should handle waitForCallback with custom serdes configuration", async () => {
      const executionPromise = runner.run();

      const callbackOperation = runner.getOperation("custom-serdes-callback");

      await callbackOperation.waitForData(WaitingOperationStatus.STARTED);

      // Send data that requires custom serialization
      const testData: CustomData = {
        id: 42,
        message: "Hello Custom Serdes",
        timestamp: new Date("2025-06-15T12:30:45Z"),
        metadata: {
          version: "2.0.0",
          processed: true,
        },
      };

      // Serialize the data using custom serdes for sending
      const serializedData = await customSerdes.serialize(testData);
      await callbackOperation.sendCallbackSuccess(serializedData!);

      const result = await executionPromise;

      expect(result.getResult()).toEqual(
        JSON.parse(
          // the result will always get stringified since it's the lambda response
          JSON.stringify({
            receivedData: testData,
            isDateObject: true,
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
