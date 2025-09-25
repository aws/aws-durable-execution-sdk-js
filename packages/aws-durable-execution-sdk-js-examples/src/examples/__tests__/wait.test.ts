import { handler } from "../wait";
import { createTests } from "./shared/test-helper";

createTests({
  name: "wait",
  functionName: "wait",
  handler,
  tests: (runner) => {
    it("should call wait for 10 seconds", async () => {
      
      const execution = await runner.run();
      
      const waitStep = runner.getOperationByIndex(0);
      expect(execution.getResult()).toBe("Function Completed");
      expect(waitStep.getWaitDetails()?.waitSeconds).toEqual(10);
    });
  },
});
