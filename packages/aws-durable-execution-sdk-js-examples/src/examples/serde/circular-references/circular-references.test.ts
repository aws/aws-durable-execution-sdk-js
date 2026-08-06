import {
  ExecutionStatus,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { refreshLogConfig } from "@aws/durable-execution-sdk-js";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./circular-references";

// This example exercises the SDK's circular-safe stringifier, which only runs
// when verbose logging is on. Verbose mode is a process-global flag, so the
// TEST owns enabling it (in beforeAll) and — critically — turning it back off
// (in afterAll) so it does not leak into other example suites that share this
// Jest worker. The handler itself stays pure and never mutates process state.
function enableVerboseLogging(): void {
  process.env.DURABLE_VERBOSE_MODE = "true";
  refreshLogConfig();
}

function disableVerboseLogging(): void {
  delete process.env.DURABLE_VERBOSE_MODE;
  refreshLogConfig();
}

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    beforeAll(enableVerboseLogging);
    afterAll(disableVerboseLogging);

    it("should fail gracefully when the thrown error graph contains circular/shared references", async () => {
      const execution = await runner.run({ payload: { mode: "circular" } });

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
