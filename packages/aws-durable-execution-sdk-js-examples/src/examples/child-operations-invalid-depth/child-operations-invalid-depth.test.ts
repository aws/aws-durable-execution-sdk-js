import { handler } from "./child-operations-invalid-depth";
import { createTests } from "../../utils/test-helper";
import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("fails the execution when childOperationsDepth is invalid", async () => {
      const result = await runner.run();

      expect(result.getStatus()).toBe(ExecutionStatus.FAILED);
      const error = result.getError();
      expect(error?.errorMessage).toMatch(/childOperationsDepth/);

      assertEventSignatures(result);
    });
  },
});
