import {
  ExecutionStatus,
  OperationStatus,
  OperationType,
} from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./class-with-dates";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should rehydrate Date properties (including nested) and preserve class methods across replay", async () => {
      const execution = await runner.run({
        payload: { title: "Durable Functions 101" },
      });

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
      // initial invocation + replay after wait
      expect(execution.getInvocations().length).toBe(2);
      // create-article + wait + inspect-article
      expect(execution.getOperations().length).toBe(3);

      const createStep = runner.getOperation("create-article");
      expect(createStep.getType()).toBe(OperationType.STEP);
      expect(createStep.getStatus()).toBe(OperationStatus.SUCCEEDED);

      const result = execution.getResult() as any;
      expect(result.title).toBe("Durable Functions 101");
      // Proves createdAt and metadata.publishedAt came back as real Dates.
      expect(result.createdAtIsDate).toBe(true);
      expect(result.publishedAtIsDate).toBe(true);
      // Proves class methods survived deserialization, and that the rehydrated
      // Dates are usable by them (isPublished calls getTime, ageMs does date
      // arithmetic) — not merely that they pass an `instanceof` check.
      expect(result.isPublished).toBe(true);
      expect(result.ageIsPositive).toBe(true);
      // The unset optional Date property is left untouched (not turned into a Date).
      expect(result.archivedAtIsUndefined).toBe(true);

      assertEventSignatures(execution);
    });
  },
});
