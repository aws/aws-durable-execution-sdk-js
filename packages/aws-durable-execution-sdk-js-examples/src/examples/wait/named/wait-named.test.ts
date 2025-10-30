import { handler } from "./wait-named";
import { createTests } from "../../../utils/test-helper";

createTests({
  name: "wait-named test",
  functionName: "wait-named",
  handler,
  tests: (runner) => {
    it("should call wait for 5 seconds", async () => {
      const execution = await runner.run();
      const waitOp = runner.getOperation("wait-2-seconds");

      expect(execution.getResult()).toBe("wait finished");
      expect(waitOp.getWaitDetails()?.waitSeconds).toEqual(2);
    });
  },
});
