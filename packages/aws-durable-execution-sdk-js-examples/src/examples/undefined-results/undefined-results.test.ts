import { handler } from "./undefined-results";
import { createTests } from "../../utils/test-helper";

createTests({
  name: "undefined-results test",
  functionName: "undefined-results",
  handler,
  tests: (runner) => {
    it("should handle step operations with undefined result after replay", async () => {
      const result = await runner.run();

      // Verify execution completed successfully despite undefined operation results
      expect(result.getResult()).toEqual("result");

      // Verify all operations were tracked even with undefined results
      const operations = result.getOperations();
      expect(operations).toHaveLength(3); // step + context + wait

      // Verify step operation with undefined result
      const stepOp = runner.getOperation("fetch-user");
      expect(stepOp.getStepDetails()?.result).toBeUndefined();

      // Verify child context operation with undefined result
      const contextOp = runner.getOperation("parent");
      expect(contextOp.getContextDetails()?.result).toBeUndefined();

      // Verify wait operation completed normally
      const waitOp = runner.getOperationByIndex(2);
      expect(waitOp.getWaitDetails()?.waitSeconds).toBe(1);
    });
  },
});
