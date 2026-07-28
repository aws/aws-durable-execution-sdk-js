import { handler } from "./parallel-invalid-max-concurrency";
import { createTests } from "../../../utils/test-helper";
import { ExecutionStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("fails the execution when maxConcurrency is invalid", async () => {
      const result = await runner.run();

      expect(result.getStatus()).toBe(ExecutionStatus.FAILED);
      const error = result.getError();
      expect(error?.errorMessage).toMatch(/maxConcurrency/);

      assertEventSignatures(result);
    });
  },
});
