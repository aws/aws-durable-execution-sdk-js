import {
  ExecutionStatus,
  OperationStatus,
  OperationType,
} from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./decider-custom-transport";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("answers check and classify in one step each", async () => {
      const execution = await runner.run({
        payload: { ticket: "My billing page is failing right now." },
      });

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
      expect(execution.getResult()).toEqual({ urgent: true, team: "billing" });

      const operations = execution.getOperations();
      expect(operations.map((operation) => operation.getName())).toEqual([
        "decider.check",
        "decider.classify",
      ]);
      for (const operation of operations) {
        expect(operation.getType()).toBe(OperationType.STEP);
        expect(operation.getStatus()).toBe(OperationStatus.SUCCEEDED);
      }
      expect(operations.map((operation) => operation.getSubType())).toEqual([
        "DeciderCheck",
        "DeciderClassify",
      ]);

      assertEventSignatures(execution);
    });
  },
});
