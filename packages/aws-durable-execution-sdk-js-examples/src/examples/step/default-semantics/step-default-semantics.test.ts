import {
  OperationStatus,
  OperationType,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./step-default-semantics";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("saves every step result across the wait and replays them", async () => {
      const execution = await runner.run();

      expect(execution.getResult()).toBe("order-3 confirmed");

      // The wait suspends the first invocation, so the execution needs two.
      expect(execution.getInvocations().length).toBeGreaterThanOrEqual(2);

      for (const name of ["count-items", "create-order-id", "confirm-order"]) {
        const step = runner.getOperation(name);
        expect(step.getType()).toBe(OperationType.STEP);
        expect(step.getStatus()).toBe(OperationStatus.SUCCEEDED);
      }
      expect(runner.getOperation("count-items").getStepDetails()?.result).toBe(
        3,
      );
      expect(
        runner.getOperation("create-order-id").getStepDetails()?.result,
      ).toBe("order-3");

      assertEventSignatures(execution);
    });
  },
});
