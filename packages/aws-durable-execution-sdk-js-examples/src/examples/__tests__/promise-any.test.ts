import { handler } from "../promise-any";
import { createTests } from "./shared/test-helper";

createTests<string>({
  name: "promise-any test",
  functionName: "promise-any",
  localRunnerConfig: {
    skipTime: false,
  },
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
        errorType: "AggregateError",
        stackTrace: expect.any(Array),
      });
      expect(execution.getOperations()).toHaveLength(4);
    }, 30000);
  },
});
