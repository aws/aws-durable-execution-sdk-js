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
        // The execution should not complete successfully
        const execution = await runner.run();
        expect(execution.getStatus()).not.toBe(ExecutionStatus.SUCCEEDED);
      } else {
        // Unhandled rejections fail the jest process, so we can't test it locally
      }
    });
  },
});
