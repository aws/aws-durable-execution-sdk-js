import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./create-callback-serdes";
import { createTests } from "../../../utils/test-helper";

// Define CustomData type to match handler
interface CustomData {
  id: number;
  message: string;
  timestamp: Date;
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
      }),
    );
  },
};

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should handle callback operations with custom serdes", async () => {
      const callbackOperation = runner.getOperation("custom-serdes-callback");
      const executionPromise = runner.run();

      await callbackOperation.waitForData(WaitingOperationStatus.STARTED);

      // Send data that requires custom serialization
      const testData: CustomData = {
        id: 42,
        message: "Hello World",
        timestamp: new Date("2025-01-01T00:00:00Z"),
      };

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

      assertEventSignatures(result);
    });
  },
});
