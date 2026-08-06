import { OperationStatus } from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./preview-truncation";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should offload the record, generate a truncated preview, and round-trip through the serdes", async () => {
      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe("SUCCEEDED");
      // A single invocation: the serdes round trip does not need a replay.
      expect(execution.getInvocations().length).toBe(1);
      // build-record + read-record
      expect(execution.getOperations().length).toBe(2);

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
