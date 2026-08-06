import { OperationStatus } from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./preview-field-selection";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should offload the profile with a field-selected preview and round-trip through the serdes", async () => {
      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe("SUCCEEDED");
      // A single invocation: the serdes round trip does not need a replay.
      expect(execution.getInvocations().length).toBe(1);
      // build-profile + read-profile
      expect(execution.getOperations().length).toBe(2);

      expect(runner.getOperation("build-profile").getStatus()).toBe(
        OperationStatus.SUCCEEDED,
      );

      const result = execution.getResult() as any;
      expect(result.id).toBe("cust-9");
      expect(result.email).toBe("person@example.com");
      expect(result.auditLength).toBe(2000);

      assertEventSignatures(execution);
    });
  },
});
