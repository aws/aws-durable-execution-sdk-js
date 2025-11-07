import { handler } from "./create-callback-timeout";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "create-callback-timeout test",
  functionName: "create-callback-timeout",
  handler,
  tests: (runner) => {
    it("should time out if there are no callback heartbeats", async () => {
      const result = await runner.run({
        payload: { timeoutType: "heartbeat" },
      });

      expect(result.getError()).toEqual({
        errorMessage: "Callback timed out on heartbeat",
        errorType: "CallbackError",
        stackTrace: expect.any(Array),
      });
    });

    it("should time out if callback times out", async () => {
      const result = await runner.run({
        payload: { timeoutType: "general" },
      });

      expect(result.getError()).toEqual({
        errorMessage: "Callback timed out",
        errorType: "CallbackError",
        stackTrace: expect.any(Array),
      });
    });
  },
});
