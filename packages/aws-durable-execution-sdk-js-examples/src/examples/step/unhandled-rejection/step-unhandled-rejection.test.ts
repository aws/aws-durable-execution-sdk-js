import { handler } from "./step-unhandled-rejection";
import { createTests } from "../../../utils/test-helper";
import { ExecutionStatus } from "@aws-sdk/client-lambda";

createTests({
  name: "step-unhandled-rejection",
  functionName: "step-unhandled-rejection",
  handler,
  tests: (runner, isCloud) => {
    it("should prevent unhandled promise rejections and complete execution gracefully", async () => {
      if (isCloud) {
        // The execution should complete successfully despite step errors
        const execution = await runner.run();
        expect(execution.getStatus()).toBe(ExecutionStatus.FAILED);
        expect(execution.getError()).toBeTruthy();
      } else {
        // Unhandled rejections fail the jest process, so we can't test it locally
      }
    });
  },
});
