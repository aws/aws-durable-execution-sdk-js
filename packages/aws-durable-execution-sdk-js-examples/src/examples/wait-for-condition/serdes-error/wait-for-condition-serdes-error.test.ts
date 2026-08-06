import { handler } from "./wait-for-condition-serdes-error";
import { createTests } from "../../../utils/test-helper";
import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should terminate execution due to serdes error", async () => {
      const result = await runner.run();

      const error = result.getError();
      expect(error).toEqual({
        errorMessage:
          "Failed to deserialize operation payload: simulated deserialization failure",
        errorType: "Error",
        stackTrace: undefined,
      });

      expect(result.getStatus()).toBe(ExecutionStatus.FAILED);

      // REQUIRED: Must call assertEventSignatures for every test
      assertEventSignatures(result);
    });
  },
});
