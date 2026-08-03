import {
  OperationStatus,
  OperationType,
} from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./filesystem-serdes";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should write the result to a file and read it back on replay", async () => {
      const execution = await runner.run({
        payload: { reportId: "RPT-001" },
      });

      expect(execution.getStatus()).toBe("SUCCEEDED");
      // initial invocation + replay after wait
      expect(execution.getInvocations().length).toBe(2);
      // generate-report step + wait + summarize-report step
      expect(execution.getOperations().length).toBe(3);

      const generateStep = runner.getOperation("generate-report");
      expect(generateStep.getType()).toBe(OperationType.STEP);
      expect(generateStep.getStatus()).toBe(OperationStatus.SUCCEEDED);

      const summarizeStep = runner.getOperation("summarize-report");
      expect(summarizeStep.getStatus()).toBe(OperationStatus.SUCCEEDED);

      // The rehydrated report round-tripped through the file store: the large
      // body length survives, proving deserialize read the file back.
      const result = execution.getResult() as any;
      expect(result.id).toBe("RPT-001");
      expect(result.status).toBe("generated");
      expect(result.bodyLength).toBe("REPORT-".repeat(20_000).length);

      assertEventSignatures(execution);
    });
  },
});
