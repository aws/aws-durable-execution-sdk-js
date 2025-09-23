import { handler } from "../wait";
import { createTests } from "./shared/test-helper";

createTests({
  name: "wait",
  functionName: "wait",
  handler,
  tests: (runner) => {
    it("should call wait for 10 seconds", async () => {
      const waitStep = runner.getOperationByIndex(0);

      const execution = await runner.run();

      expect(execution.getResult()).toBe("Function Completed");
      expect(waitStep.getWaitDetails()?.waitSeconds).toEqual(10);
    });
  },
});
