import { handler } from "./lazy-evaluation";
import { createTests } from "../../utils/test-helper";

createTests({
  name: "lazy-evaluation",
  functionName: "lazy-evaluation",
  handler,
  tests: (runner) => {
    it("should demonstrate lazy promise evaluation - no operations created when promises are not awaited", async () => {
      const execution = await runner.run();
      const operations = execution.getOperations();

      // Since the promises are lazy and were never awaited, no operations other than the wait should exist
      expect(operations.length).toBe(1);
      expect(operations[0].getName()).toBe("wait-1");
    });
  },
});
