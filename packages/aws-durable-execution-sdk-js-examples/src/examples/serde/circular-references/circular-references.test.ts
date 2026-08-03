import {
  ExecutionStatus,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { refreshLogConfig } from "@aws/durable-execution-sdk-js";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./circular-references";

// The handler turns verbose logging on (a process-global flag) so the SDK
// exercises its circular-safe stringifier. Turn it back off after every run so
// verbose logging does not leak into other example test files that share this
// worker process.
function disableVerboseLogging(): void {
  delete process.env.DURABLE_VERBOSE_MODE;
  refreshLogConfig();
}

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    afterEach(disableVerboseLogging);
    afterAll(disableVerboseLogging);

    it("should fail gracefully when the thrown error graph contains circular/shared references", async () => {
      const execution = await runner.run({ payload: { mode: "circular" } });
      disableVerboseLogging();

      // The prepare step ran before the handler threw.
      expect(runner.getOperation("prepare-order").getStatus()).toBe(
        OperationStatus.SUCCEEDED,
      );

      // The circular error propagated: the invocation failed but did not crash —
      // the SDK's verbose logging safely stringified the self-referential graph.
      expect(execution.getStatus()).toBe(ExecutionStatus.FAILED);
      expect(execution.getError()?.errorMessage).toBe(
        "Failed to reconcile order graph",
      );

      assertEventSignatures(execution, "circular");
    });

    it("should fail gracefully when the thrown error carries a non-serializable BigInt", async () => {
      const execution = await runner.run({ payload: { mode: "bigint" } });
      disableVerboseLogging();

      expect(runner.getOperation("prepare-order").getStatus()).toBe(
        OperationStatus.SUCCEEDED,
      );

      expect(execution.getStatus()).toBe(ExecutionStatus.FAILED);
      expect(execution.getError()?.errorMessage).toBe(
        "Order total overflowed a safe integer",
      );

      assertEventSignatures(execution, "bigint");
    });
  },
});
