import { handler } from "./promise-combinators";
import { createTests } from "../../../utils/test-helper";

createTests({
  localRunnerConfig: {
    skipTime: false,
  },
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should execute all promise combinators successfully", async () => {
      const execution = await runner.run();

      const result = execution.getResult() as any;

      // Verify the structure of the result
      expect(result.message).toBe(
        "Promise combinators example completed successfully",
      );
      expect(result.allResults).toEqual([
        "Result from step 1",
        "Result from step 2",
        "Result from step 3",
      ]);
      expect(result.raceResult).toBe("Fast result");
      expect(result.settledResults).toHaveLength(2);
      expect(result.settledResults[0]).toEqual({
        status: "fulfilled",
        value: "Success!",
      });
      expect(result.settledResults[1].status).toBe("rejected");
      expect(result.settledResults[1].reason.name).toBe("StepError");
      expect(result.anyResult).toBe("First success!");

      assertEventSignatures(execution);
    }, 30000);
  },
});
