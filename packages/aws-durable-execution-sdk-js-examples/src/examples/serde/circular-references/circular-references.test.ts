import {
  ExecutionStatus,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { refreshLogConfig } from "@aws/durable-execution-sdk-js";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./circular-references";

// This example exercises the SDK's circular-safe stringifier, which only runs
// when verbose logging is on. Verbose mode is a process-global flag, so the
// TEST owns enabling it (in beforeAll) and — critically — putting it back as it
// was (in afterAll) so it does not leak into other example suites that share
// this Jest worker. The handler itself stays pure and never mutates process
// state.
//
// Restore rather than delete: if the flag was already set in the environment,
// unsetting it would turn verbose logging off for every later suite in this
// worker, which is the leak this is meant to prevent.
let previousVerboseMode: string | undefined;

function enableVerboseLogging(): void {
  previousVerboseMode = process.env.DURABLE_VERBOSE_MODE;
  process.env.DURABLE_VERBOSE_MODE = "true";
  refreshLogConfig();
}

function restoreVerboseLogging(): void {
  if (previousVerboseMode === undefined) {
    delete process.env.DURABLE_VERBOSE_MODE;
  } else {
    process.env.DURABLE_VERBOSE_MODE = previousVerboseMode;
  }
  refreshLogConfig();
}

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    let debugSpy: jest.SpyInstance;

    beforeAll(enableVerboseLogging);
    afterAll(restoreVerboseLogging);

    // The SDK's verbose logger writes through console.debug and passes logged
    // values through safeStringify. Capturing that output is the only way to
    // assert the stringifier's behaviour: the thrown error's `message` comes
    // from the Error itself, so asserting on it alone would still pass if the
    // stringifier silently stopped substituting its markers.
    beforeEach(() => {
      debugSpy = jest.spyOn(console, "debug").mockImplementation(() => {});
    });

    afterEach(() => {
      debugSpy.mockRestore();
    });

    const loggedOutput = () => debugSpy.mock.calls.flat().join("\n");

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

      // The cycle was replaced with the "[Circular]" marker rather than throwing
      // "Converting circular structure to JSON", and the graph really was logged
      // (the non-circular part of it still appears).
      const output = loggedOutput();
      expect(output).toContain("[Circular]");
      expect(output).toContain("order-1");

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

      // A BigInt cannot be serialized at all, so the stringifier falls back to
      // its "[Unable to stringify]" marker instead of letting the TypeError
      // escape and take down the invocation.
      expect(loggedOutput()).toContain("[Unable to stringify]");

      assertEventSignatures(execution, "bigint");
    });
  },
});
