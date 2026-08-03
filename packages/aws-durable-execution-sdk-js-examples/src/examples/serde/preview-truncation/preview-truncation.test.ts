import { OperationStatus } from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./preview-truncation";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should offload the record, generate a truncated preview, and round-trip on replay", async () => {
      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getInvocations().length).toBe(2);
      // build-record + wait + read-record
      expect(execution.getOperations().length).toBe(3);

      expect(runner.getOperation("build-record").getStatus()).toBe(
        OperationStatus.SUCCEEDED,
      );

      const result = execution.getResult() as any;
      expect(result.id).toBe("acct-123");
      expect(result.tier).toBe("gold");
      expect(result.notesLength).toBe(500);

      assertEventSignatures(execution);
    });
  },
});
