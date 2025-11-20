import { handler } from "./promise-any";
import { createTests } from "../../../utils/test-helper";

createTests<string>({
  name: "promise-any test",
  functionName: "promise-any",
  handler,
  tests: (runner) => {
    it("should return first successful promise result", async () => {
      const execution = await runner.run();

      expect(execution.getOperations()).toHaveLength(4);

      const result = execution.getResult();
      expect(result).toBe("first success");
    });

    it("should fail if all promises fail - failure case", async () => {
      const execution = await runner.run({
        payload: {
          shouldFail: true,
        },
      });

      expect(execution.getError()).toEqual({
        errorMessage: "All promises were rejected",
        errorType: "StepError",
        errorData: undefined,
        stackTrace: undefined,
      });
      expect(execution.getOperations()).toHaveLength(4);
    });
  },
});
