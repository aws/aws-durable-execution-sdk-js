import { handler } from "./create-callback-timeout";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner) => {
    it("should time out if there are no callback heartbeats", async () => {
      const result = await runner.run({
        payload: { timeoutType: "heartbeat" },
      });

      expect(result.getError()).toEqual({
        errorData: undefined,
        errorMessage: "Callback timed out on heartbeat",
        errorType: "CallbackError",
        stackTrace: undefined,
      });
    });

    it("should time out if callback times out", async () => {
      const result = await runner.run({
        payload: { timeoutType: "general" },
      });

      expect(result.getError()).toEqual({
        errorData: undefined,
        errorMessage: "Callback timed out",
        errorType: "CallbackError",
        stackTrace: undefined,
      });
    });
  },
});
