import { handler } from "./otel-unified-factory";
import { createTests } from "../../../utils/test-helper";

createTests<string>({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("completes a workflow using the unified OTel factory", async () => {
      const execution = await runner.run();
      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getResult()).toBe("prepared and finished");
      expect(runner.getOperation("prepare").getStepDetails()?.result).toBe(
        "prepared",
      );
      expect(runner.getOperation("finish").getStepDetails()?.result).toBe(
        "prepared and finished",
      );
      assertEventSignatures(execution);
    });
  },
});
