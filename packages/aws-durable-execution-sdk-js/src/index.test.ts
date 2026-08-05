import * as sdk from "./index";

/**
 * Smoke test for the package entry point.
 *
 * Importing the barrel under ts-jest is its own assertion. Nothing else in the suite does
 * it, which has already allowed one regression: adding an import of the version module to
 * `index.ts` under a specifier the `moduleNameMapper` did not cover made the real module
 * load, and ts-jest rejected its `import.meta.url` with TS1343. CI stayed green because no
 * test reached the barrel. This file closes that gap — if the entry point cannot be
 * compiled or evaluated, it fails here rather than for whoever next writes a barrel-level
 * test.
 *
 * Only runtime values can be checked; type-only exports are erased. The wire enums are
 * asserted by value because their strings are part of the service contract.
 */
describe("package entry point", () => {
  it("exports the handler wrapper", () => {
    expect(typeof sdk.withDurableExecution).toBe("function");
  });

  it("exports the durable execution client", () => {
    expect(typeof sdk.DurableExecutionApiClient).toBe("function");
  });

  it("exports the wire protocol enums with their contract values", () => {
    expect(sdk.OperationType).toEqual({
      CALLBACK: "CALLBACK",
      CHAINED_INVOKE: "CHAINED_INVOKE",
      CONTEXT: "CONTEXT",
      EXECUTION: "EXECUTION",
      STEP: "STEP",
      WAIT: "WAIT",
    });
    expect(sdk.OperationStatus).toEqual({
      CANCELLED: "CANCELLED",
      FAILED: "FAILED",
      PENDING: "PENDING",
      READY: "READY",
      STARTED: "STARTED",
      STOPPED: "STOPPED",
      SUCCEEDED: "SUCCEEDED",
      TIMED_OUT: "TIMED_OUT",
    });
    expect(sdk.OperationAction).toEqual({
      CANCEL: "CANCEL",
      FAIL: "FAIL",
      RETRY: "RETRY",
      START: "START",
      SUCCEED: "SUCCEED",
    });
  });

  it("exports the version string", () => {
    // Resolved through the version module, which is the import that regressed.
    expect(typeof sdk.SDK_VERSION).toBe("string");
    expect(sdk.SDK_VERSION.length).toBeGreaterThan(0);
  });

  it("exports the error types", () => {
    expect(typeof sdk.DurableOperationError).toBe("function");
    expect(typeof sdk.StepError).toBe("function");
    expect(typeof sdk.CallbackError).toBe("function");
    expect(typeof sdk.StepInterruptedError).toBe("function");
  });

  it("exports the retry and wait strategy helpers", () => {
    expect(typeof sdk.createRetryStrategy).toBe("function");
    expect(typeof sdk.createLinearRetryStrategy).toBe("function");
    expect(typeof sdk.createWaitStrategy).toBe("function");
    expect(typeof sdk.withRetry).toBe("function");
    expect(sdk.retryPresets).toBeDefined();
  });

  it("exports the serdes helpers", () => {
    expect(sdk.defaultSerdes).toBeDefined();
    expect(typeof sdk.createClassSerdes).toBe("function");
    expect(typeof sdk.createFileSystemSerdes).toBe("function");
    expect(typeof sdk.buildPreview).toBe("function");
  });

  it("exports the batch completion helpers", () => {
    expect(typeof sdk.completeBatch).toBe("function");
    expect(typeof sdk.continueBatch).toBe("function");
  });
});
