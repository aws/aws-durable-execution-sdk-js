import {
  OperationStatus,
  OperationType,
} from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./configure-serdes";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should apply default serdes to all steps without per-step configuration", async () => {
      const execution = await runner.run({
        payload: { orderId: "ORD-001", amount: 99.99 },
      });

      expect(execution.getStatus()).toBe("SUCCEEDED");
      // initial invocation + replay after wait
      expect(execution.getInvocations().length).toBe(2);
      // create-order step + wait + process-order step
      expect(execution.getOperations().length).toBe(3);

      const createStep = runner.getOperation("create-order");
      expect(createStep.getType()).toBe(OperationType.STEP);
      expect(createStep.getStatus()).toBe(OperationStatus.SUCCEEDED);

      const processStep = runner.getOperation("process-order");
      expect(processStep.getType()).toBe(OperationType.STEP);
      expect(processStep.getStatus()).toBe(OperationStatus.SUCCEEDED);

      const result = execution.getResult() as any;
      // summary() works — proves class methods were preserved by the default serdes
      expect(result.summary).toBe("Order ORD-001: $99.99 (processed)");
      expect(result.status).toBe("processed");

      assertEventSignatures(execution);
    });
  },
});
