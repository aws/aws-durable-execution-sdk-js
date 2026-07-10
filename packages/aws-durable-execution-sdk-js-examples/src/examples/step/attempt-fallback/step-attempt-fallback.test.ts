import { handler } from "./step-attempt-fallback";
import { createTests } from "../../../utils/test-helper";
import { OperationStatus } from "@aws/durable-execution-sdk-js-testing";

createTests({
  localRunnerConfig: {
    skipTime: true,
  },
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should fail over to the next supplier on each retry until one succeeds", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // The first two suppliers are out of stock; the third (attempt 3) succeeds.
      expect(result.supplier).toBe("supplier-c");
      expect(result.attempt).toBe(3);
      expect(result.status).toBe("backordered");

      const stepOp = runner.getOperation("place-backorder");
      expect(stepOp?.getStatus()).toBe(OperationStatus.SUCCEEDED);

      assertEventSignatures(execution);
    });
  },
});
