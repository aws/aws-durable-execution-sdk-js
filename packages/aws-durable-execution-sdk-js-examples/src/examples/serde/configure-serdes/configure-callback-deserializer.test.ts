import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./configure-callback-deserializer";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures }) => {
    it("should deserialize callback result exactly once with defaultCallbackDeserializer", async () => {
      const executionPromise = runner.run();

      const callbackOp = runner.getOperation("approval");
      await callbackOp.waitForData(WaitingOperationStatus.SUBMITTED);

      // Send a JSON-encoded object as the callback result.
      // If double-deserialization occurs, the first parse gives { value: 42 },
      // and the second parse would throw (can't JSON.parse an object).
      await callbackOp.sendCallbackSuccess(JSON.stringify({ value: 42 }));

      const result = await executionPromise;

      expect(result.getStatus()).toBe("SUCCEEDED");
      // The deserializer should have run exactly once: raw string -> { value: 42 }
      expect(result.getResult()).toEqual({ received: { value: 42 } });

      assertEventSignatures(result);
    });
  },
});
