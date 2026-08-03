import { OperationStatus } from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./preview-field-selection";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should offload the profile with a field-selected preview and round-trip on replay", async () => {
      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getInvocations().length).toBe(2);
      // build-profile + wait + read-profile
      expect(execution.getOperations().length).toBe(3);

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
