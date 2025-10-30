import { ExecutionStatus } from "@aws-sdk/client-lambda";
import { handler } from "./simple-execution";
import { createTests } from "../../utils/test-helper";

createTests({
  name: "simple-execution test",
  functionName: "simple-execution",
  handler,
  tests: (runner) => {
    it("should execute simple handler without operations", async () => {
      const testPayload = {
        userId: "test-user",
        action: "simple-execution",
      };

      const result = await runner.run({ payload: testPayload });

      const resultData = result.getResult() as {
        received: unknown;
        timestamp: number;
        message: string;
      };

      // Verify the result structure and content
      expect(resultData).toMatchObject({
        received: JSON.stringify(testPayload),
        message: "Handler completed successfully",
      });
      expect(typeof resultData.timestamp).toBe("number");

      // Should have no operations for simple execution
      expect(result.getOperations()).toHaveLength(0);

      // Verify no error occurred
      expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    });
  },
});
