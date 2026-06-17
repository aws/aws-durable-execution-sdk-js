/**
 * Bug Condition Exploration Test: Virtual Context Causes Premature ExecutionMode Transition
 *
 * Root cause being tested:
 * `checkAndUpdateReplayMode()` runs during the virtual context's own `withDurableModeManagement` call.
 * It peeks at `_stepCounter + 1` which is the ID the virtual context will consume. Since virtual
 * contexts never checkpoint, no step data exists for that ID, and the mode transitions to
 * `ExecutionMode`. This causes `context.logger` between operations to emit duplicate logs on replay.
 */

import { createTestDurableContext } from "../../testing/create-test-durable-context";
import { DurableExecutionMode } from "../../types";
import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";
import { runWithContext } from "../../utils/context-tracker/context-tracker";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

describe("Bug Condition: Virtual Context Causes Premature ExecutionMode Transition", () => {
  /**
   * Test Case 1: Single virtual context before a step
   *
   * Setup: DurableContextImpl in ReplayMode with checkpoint data for step ID "1"
   * (where the first real step SHOULD land after fix: virtual gets "0.1", step gets "1").
   *
   * Bug behavior: virtual context's withDurableModeManagement calls checkAndUpdateReplayMode,
   * which peeks at _stepCounter + 1 = "1". Since the virtual context will consume "1" but
   * never checkpoints, no step data exists → mode transitions to ExecutionMode.
   * Then the real step gets ID "2" (counter was incremented by virtual) and executes in
   * ExecutionMode, returning "new-execution-value".
   *
   * Expected (after fix): virtual gets "0.1" (separate counter), real step gets "1",
   * checkAndUpdateReplayMode finds data at "1" → stays ReplayMode → returns checkpointed value.
   */
  it("single virtual context before a step: mode should remain ReplayMode for next real operation", async () => {
    // Checkpoint data for step "1" (hashed) — the real step's expected ID after fix
    const existingOperations = [
      {
        Id: hashId("1"),
        Type: OperationType.STEP,
        StartTimestamp: new Date(),
        Status: OperationStatus.SUCCEEDED,
        StepDetails: { Result: JSON.stringify("checkpointed-value") },
      },
    ];

    const { context } = createTestDurableContext({
      durableExecutionMode: DurableExecutionMode.ReplayMode,
      existingOperations,
    });

    // Execute a virtual child context — triggers the bug
    await context.runInChildContext(
      "virtual-ctx",
      async (childCtx) => {
        return "virtual-result";
      },
      { virtualContext: true },
    );

    // Real step. If mode stayed ReplayMode and step ID is "1" (has checkpoint),
    // this returns "checkpointed-value". If bug exists, returns "new-execution-value".
    const result = await context.step("real-step", async () => {
      return "new-execution-value";
    });

    // Expected (after fix): checkpointed-value
    // Bug behavior: new-execution-value (mode transitioned to ExecutionMode, step ID drifted)
    expect(result).toBe("checkpointed-value");
  });

  /**
   * Test Case 2: Virtual context between two real operations
   *
   * step (ID "1") → virtual → second step (ID "2" after fix)
   * Both real steps have checkpoint data. Virtual context should not shift IDs.
   */
  it("virtual context between two real operations: mode should remain ReplayMode for second step", async () => {
    // Checkpoint data for step "1" and step "2" (both real steps after fix)
    // In unfixed code: step gets "1", virtual gets "2", second step gets "3" (no checkpoint)
    // In fixed code: step gets "1", virtual gets "1.1", second step gets "2"
    const existingOperations = [
      {
        Id: hashId("1"),
        Type: OperationType.STEP,
        StartTimestamp: new Date(),
        Status: OperationStatus.SUCCEEDED,
        StepDetails: { Result: JSON.stringify("first-checkpointed") },
      },
      {
        Id: hashId("2"),
        Type: OperationType.STEP,
        StartTimestamp: new Date(),
        Status: OperationStatus.SUCCEEDED,
        StepDetails: { Result: JSON.stringify("second-checkpointed") },
      },
    ];

    const { context } = createTestDurableContext({
      durableExecutionMode: DurableExecutionMode.ReplayMode,
      existingOperations,
    });

    // First real step — should replay fine (checkpoint at "1")
    const result1 = await context.step("step-1", async () => {
      return "step-1-new";
    });
    expect(result1).toBe("first-checkpointed");

    // Virtual child context — should NOT affect main step counter
    await context.runInChildContext(
      "virtual-ctx",
      async (childCtx) => {
        return "virtual-result";
      },
      { virtualContext: true },
    );

    // Second real step — should replay from checkpoint at "2"
    // Bug: virtual consumed "2" from main counter, this step gets "3" (no data) → executes
    // Fix: virtual gets "1.1", this step gets "2" (has data) → replays
    const result2 = await context.step("step-2", async () => {
      return "step-2-new";
    });

    expect(result2).toBe("second-checkpointed");
  });

  /**
   * Test Case 3: Multiple virtual contexts then check mode
   *
   * Two virtual contexts → real step
   * Real step should still get ID "1" (after fix) and replay from checkpoint.
   */
  it("multiple virtual contexts: mode should remain ReplayMode for subsequent real operation", async () => {
    // Checkpoint data for step "1" (where real step should land after fix)
    // In unfixed code: first virtual gets "1", second virtual gets "2", real step gets "3"
    // In fixed code: first virtual gets "0.1", second virtual gets "0.2", real step gets "1"
    const existingOperations = [
      {
        Id: hashId("1"),
        Type: OperationType.STEP,
        StartTimestamp: new Date(),
        Status: OperationStatus.SUCCEEDED,
        StepDetails: { Result: JSON.stringify("checkpointed-after-virtuals") },
      },
    ];

    const { context } = createTestDurableContext({
      durableExecutionMode: DurableExecutionMode.ReplayMode,
      existingOperations,
    });

    // First virtual context
    await context.runInChildContext(
      "virtual-1",
      async (childCtx) => {
        return "virtual-1-result";
      },
      { virtualContext: true },
    );

    // Second virtual context
    await context.runInChildContext(
      "virtual-2",
      async (childCtx) => {
        return "virtual-2-result";
      },
      { virtualContext: true },
    );

    // Real step — should replay from checkpoint at "1"
    const result = await context.step("real-step", async () => {
      return "real-step-new";
    });

    expect(result).toBe("checkpointed-after-virtuals");
  });

  /**
   * Test Case 4: Verify logger suppression during replay with virtual contexts
   *
   * context.logger.info(...) should be suppressed between operations during replay
   * when virtual contexts precede them. The bug causes ExecutionMode transition,
   * which makes logger emit logs that should be suppressed.
   *
   * After the fix:
   * - Virtual context gets dot-separated ID "0.1" (doesn't consume main counter)
   * - checkAndUpdateReplayMode peeks at _stepCounter + 1 = "1", finds checkpoint data → stays ReplayMode
   * - logger.info between operations is correctly suppressed
   *
   * In unfixed code:
   * - Virtual context consumes step "1" from main counter
   * - checkAndUpdateReplayMode peeks at "1" (which virtual will consume, no checkpoint)
   * - Transitions to ExecutionMode → logger.info emits (bug behavior)
   */
  it("context.logger.info should be suppressed between operations during replay when virtual contexts precede them", async () => {
    // Provide checkpoint data at step "1" — the REAL step's expected position after fix.
    // After fix: virtual gets "0.1", checkAndUpdateReplayMode peeks at "1" → finds data → stays ReplayMode.
    // In unfixed code: virtual consumes "1" from main counter, its own checkAndUpdateReplayMode
    // may peek at a shifted position, and the mode transitions to ExecutionMode.
    const existingOperations = [
      {
        Id: hashId("1"),
        Type: OperationType.STEP,
        StartTimestamp: new Date(),
        Status: OperationStatus.SUCCEEDED,
        StepDetails: { Result: JSON.stringify("checkpointed") },
      },
    ];

    const { context } = createTestDurableContext({
      durableExecutionMode: DurableExecutionMode.ReplayMode,
      existingOperations,
    });

    // Track if logger.info actually executes via a custom logger
    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };
    context.configureLogger({ customLogger: mockLogger as any });

    // Execute a virtual child context
    // In unfixed code: withDurableModeManagement → checkAndUpdateReplayMode peeks at "1"
    // → virtual consumes "1" but never checkpoints → transitions to ExecutionMode!
    // In fixed code: virtual gets "0.1", checkAndUpdateReplayMode peeks at "1" → data exists → stays ReplayMode
    await context.runInChildContext(
      "virtual-ctx",
      async (childCtx) => {
        return "virtual-result";
      },
      { virtualContext: true },
    );

    // Log between operations — should be suppressed in ReplayMode
    // In unfixed code: mode already transitioned to ExecutionMode during virtual's mode management
    // So logger.info WILL emit (bug behavior)
    // In fixed code: virtual doesn't affect mode, data at "1" keeps mode in ReplayMode
    // → logger.info is suppressed
    runWithContext(
      "root",
      undefined,
      () => {
        context.logger.info("between-operations-log");
      },
      undefined,
      DurableExecutionMode.ReplayMode,
    );

    // If mode stayed ReplayMode: log is suppressed (info not called)
    // If bug exists (mode = ExecutionMode): log emits
    expect(mockLogger.info).not.toHaveBeenCalled();
  });
});
