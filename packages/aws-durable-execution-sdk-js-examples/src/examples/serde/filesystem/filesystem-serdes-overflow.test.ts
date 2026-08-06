import { rm } from "node:fs/promises";
import {
  ExecutionStatus,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { basePath, handler } from "./filesystem-serdes-overflow";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    // The large-document step overflows ~300KB to a temp file each run; remove
    // the base directory afterwards so runs do not accumulate on disk.
    afterAll(async () => {
      await rm(basePath, { recursive: true, force: true });
    });

    it("should keep small values inline, overflow large values to a file, and pass through undefined", async () => {
      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
      // A single invocation: the serdes round trip does not need a replay.
      expect(execution.getInvocations().length).toBe(1);
      // small + large + empty + combine
      expect(execution.getOperations().length).toBe(4);

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
