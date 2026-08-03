import { OperationStatus } from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./filesystem-serdes-overflow";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should keep small values inline, overflow large values to a file, and pass through undefined", async () => {
      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe("SUCCEEDED");
      // initial invocation + replay after wait
      expect(execution.getInvocations().length).toBe(2);
      // small + large + empty + wait + combine
      expect(execution.getOperations().length).toBe(5);

      expect(runner.getOperation("small-record").getStatus()).toBe(
        OperationStatus.SUCCEEDED,
      );
      expect(runner.getOperation("large-document").getStatus()).toBe(
        OperationStatus.SUCCEEDED,
      );
      expect(runner.getOperation("empty-record").getStatus()).toBe(
        OperationStatus.SUCCEEDED,
      );

      const result = execution.getResult() as any;
      expect(result.smallOrderId).toBe("ORD-42");
      expect(result.largeLength).toBe(300 * 1024);
      expect(result.nothingIsUndefined).toBe(true);

      assertEventSignatures(execution);
    });
  },
});
