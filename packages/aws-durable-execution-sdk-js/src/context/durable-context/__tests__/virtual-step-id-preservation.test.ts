/**
 * Preservation Property Tests: Non-Virtual Operations Produce Identical Step IDs and Replay Behavior
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 *
 * These tests capture the existing (unfixed) behavior for NON-VIRTUAL operations:
 * - Sequential step IDs from _stepCounter
 * - Dash-separated nesting format for child contexts
 * - checkAndUpdateReplayMode stays in ReplayMode when checkpoint data exists
 * - checkAndUpdateReplayMode transitions to ExecutionMode when no checkpoint data exists
 *
 * These tests MUST PASS on the current unfixed code to establish a baseline
 * that must not regress when the virtual context fix is applied.
 */

import * as fc from "fast-check";
import { createTestDurableContext } from "../../../testing/create-test-durable-context";
import { DurableExecutionMode } from "../../../types";
import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";
import { hashId } from "../../../utils/step-id-utils/step-id-utils";

/**
 * Helper to extract step IDs from checkpoint mock calls.
 * The checkpoint.checkpoint mock is called with (stepId, operationData).
 */
function getCheckpointedStepIds(checkpointMock: jest.Mock): string[] {
  return checkpointMock.mock.calls.map((call: any[]) => call[0]);
}

describe("Preservation Property: Non-Virtual Operations Step ID and Replay Behavior", () => {
  /**
   * **Validates: Requirements 3.1, 3.4**
   *
   * Property: For all sequences of non-virtual operations (steps),
   * step IDs are sequential integers from _stepCounter with appropriate prefix.
   */
  describe("Sequential step ID generation", () => {
    it("should produce IDs 1, 2, 3, ... for sequential step() calls without prefix", async () => {
      const { context } = createTestDurableContext({
        durableExecutionMode: DurableExecutionMode.ExecutionMode,
      });

      await context.step("s1", async () => "r1");
      await context.step("s2", async () => "r2");
      await context.step("s3", async () => "r3");

      // Verify the step handler was called with sequential IDs by checking
      // the checkpoint mock. Each step checkpoints with its assigned ID.
      const checkpointMock = (context as any).checkpoint
        .checkpoint as jest.Mock;
      const stepIds = getCheckpointedStepIds(checkpointMock);

      expect(stepIds).toContain("1");
      expect(stepIds).toContain("2");
      expect(stepIds).toContain("3");
    });

    it("should produce prefixed IDs for child context steps", async () => {
      const { context } = createTestDurableContext({
        durableExecutionMode: DurableExecutionMode.ExecutionMode,
        stepPrefix: "parent",
      });

      await context.step("s1", async () => "r1");
      await context.step("s2", async () => "r2");

      const checkpointMock = (context as any).checkpoint
        .checkpoint as jest.Mock;
      const stepIds = getCheckpointedStepIds(checkpointMock);

      expect(stepIds).toContain("parent-1");
      expect(stepIds).toContain("parent-2");
    });

    it("property: step IDs are sequential integers for any number of steps", async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (numSteps) => {
          const { context } = createTestDurableContext({
            durableExecutionMode: DurableExecutionMode.ExecutionMode,
          });

          for (let i = 0; i < numSteps; i++) {
            await context.step(`step-${i}`, async () => `result-${i}`);
          }

          const checkpointMock = (context as any).checkpoint
            .checkpoint as jest.Mock;
          const stepIds = getCheckpointedStepIds(checkpointMock);

          // Verify sequential IDs 1 through numSteps were used
          for (let i = 1; i <= numSteps; i++) {
            expect(stepIds).toContain(`${i}`);
          }
        }),
        { numRuns: 30 },
      );
    });
  });

  /**
   * **Validates: Requirements 3.1, 3.3**
   *
   * Property: For all non-virtual child contexts, step IDs use
   * dash-separated nesting format {parentPrefix}-{stepCounter}
   */
  describe("Non-virtual child context step ID nesting", () => {
    it("should assign dash-separated step IDs for non-virtual child contexts", async () => {
      const { context } = createTestDurableContext({
        durableExecutionMode: DurableExecutionMode.ExecutionMode,
      });

      // Run a non-virtual child context - it consumes step ID "1" from the main counter
      await context.runInChildContext("child1", async (childCtx) => {
        // Inside child context, steps use prefix "1" (the parent's assigned step ID)
        await childCtx.step("inner-step", async () => "inner-result");
        return "child-result";
      });

      const checkpointMock = (context as any).checkpoint
        .checkpoint as jest.Mock;
      const stepIds = getCheckpointedStepIds(checkpointMock);

      // The child context itself gets step ID "1" (checkpointed at start/finish)
      expect(stepIds).toContain("1");
      // The nested step gets ID "1-1" (dash-separated: parentStepId-childStepCounter)
      expect(stepIds).toContain("1-1");
    });

    it("should maintain correct nesting for multiple non-virtual child contexts", async () => {
      const { context } = createTestDurableContext({
        durableExecutionMode: DurableExecutionMode.ExecutionMode,
      });

      // First child context gets step ID "1"
      await context.runInChildContext("child1", async (childCtx) => {
        await childCtx.step("step-a", async () => "a");
        await childCtx.step("step-b", async () => "b");
        return "result1";
      });

      // Second child context gets step ID "2"
      await context.runInChildContext("child2", async (childCtx) => {
        await childCtx.step("step-c", async () => "c");
        return "result2";
      });

      const checkpointMock = (context as any).checkpoint
        .checkpoint as jest.Mock;
      const stepIds = getCheckpointedStepIds(checkpointMock);

      // Verify parent-level IDs
      expect(stepIds).toContain("1");
      expect(stepIds).toContain("2");

      // Verify nested IDs use dash format
      expect(stepIds).toContain("1-1");
      expect(stepIds).toContain("1-2");
      expect(stepIds).toContain("2-1");
    });

    it("property: non-virtual child contexts use dash-separated nesting", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 4 }), // number of child contexts
          fc.integer({ min: 1, max: 3 }), // steps per child context
          async (numChildren, stepsPerChild) => {
            const { context } = createTestDurableContext({
              durableExecutionMode: DurableExecutionMode.ExecutionMode,
            });

            for (let i = 0; i < numChildren; i++) {
              await context.runInChildContext(
                `child-${i}`,
                async (childCtx) => {
                  for (let j = 0; j < stepsPerChild; j++) {
                    await childCtx.step(`step-${j}`, async () => `r-${j}`);
                  }
                  return `result-${i}`;
                },
              );
            }

            const checkpointMock = (context as any).checkpoint
              .checkpoint as jest.Mock;
            const stepIds = getCheckpointedStepIds(checkpointMock);

            // Verify each child context got a sequential parent ID
            for (let i = 1; i <= numChildren; i++) {
              expect(stepIds).toContain(`${i}`);
            }

            // Verify each child step got dash-separated nested IDs
            for (let i = 1; i <= numChildren; i++) {
              for (let j = 1; j <= stepsPerChild; j++) {
                expect(stepIds).toContain(`${i}-${j}`);
              }
            }
          },
        ),
        { numRuns: 20 },
      );
    });
  });

  /**
   * **Validates: Requirements 3.2, 3.4**
   *
   * Property: For all replay mode checks with checkpoint data present,
   * mode remains ReplayMode — the step function body is NOT executed.
   */
  describe("checkAndUpdateReplayMode stays in ReplayMode with checkpoint data", () => {
    it("should stay in ReplayMode and skip step execution when checkpoint data exists", async () => {
      // Create operations for step IDs "1", "2", "3" with results
      const existingOperations = [
        {
          Id: hashId("1"),
          Type: OperationType.STEP,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          StepDetails: { Result: JSON.stringify("cached-1") },
        },
        {
          Id: hashId("2"),
          Type: OperationType.STEP,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          StepDetails: { Result: JSON.stringify("cached-2") },
        },
        {
          Id: hashId("3"),
          Type: OperationType.STEP,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          StepDetails: { Result: JSON.stringify("cached-3") },
        },
      ];

      const { context } = createTestDurableContext({
        durableExecutionMode: DurableExecutionMode.ReplayMode,
        existingOperations,
      });

      // Track whether step functions are called
      const stepFnCalls: string[] = [];

      const result1 = await context.step("s1", async () => {
        stepFnCalls.push("s1");
        return "new-value-1";
      });
      const result2 = await context.step("s2", async () => {
        stepFnCalls.push("s2");
        return "new-value-2";
      });
      const result3 = await context.step("s3", async () => {
        stepFnCalls.push("s3");
        return "new-value-3";
      });

      // Steps should return cached results (not new values)
      expect(result1).toBe("cached-1");
      expect(result2).toBe("cached-2");
      expect(result3).toBe("cached-3");

      // Step function bodies should NOT have been called (replay skips execution)
      expect(stepFnCalls).toEqual([]);
    });

    it("property: replay mode is maintained for all checkpointed steps in sequence", async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async (numSteps) => {
          // Create checkpoint data for all steps with results
          const existingOperations = Array.from(
            { length: numSteps },
            (_, i) => ({
              Id: hashId(`${i + 1}`),
              Type: OperationType.STEP,
              StartTimestamp: new Date(),
              Status: OperationStatus.SUCCEEDED,
              StepDetails: {
                Result: JSON.stringify(`cached-${i + 1}`),
              },
            }),
          );

          const { context } = createTestDurableContext({
            durableExecutionMode: DurableExecutionMode.ReplayMode,
            existingOperations,
          });

          const executedSteps: number[] = [];

          // Execute all steps - they should all replay from cache
          for (let i = 0; i < numSteps; i++) {
            const result = await context.step(`step-${i}`, async () => {
              executedSteps.push(i);
              return `fresh-${i}`;
            });
            // Should get cached value, not fresh value
            expect(result).toBe(`cached-${i + 1}`);
          }

          // No step functions should have been called
          expect(executedSteps).toEqual([]);
        }),
        { numRuns: 30 },
      );
    });
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * Property: For all replay mode checks without checkpoint data,
   * mode transitions to ExecutionMode — step functions execute freshly.
   */
  describe("checkAndUpdateReplayMode transitions to ExecutionMode without checkpoint data", () => {
    it("should transition to ExecutionMode when no checkpoint data exists for next step", async () => {
      // Create checkpoint data for only step "1" - step "2" has no data
      const existingOperations = [
        {
          Id: hashId("1"),
          Type: OperationType.STEP,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          StepDetails: { Result: JSON.stringify("cached-1") },
        },
      ];

      const { context } = createTestDurableContext({
        durableExecutionMode: DurableExecutionMode.ReplayMode,
        existingOperations,
      });

      const executedSteps: string[] = [];

      // Step 1 replays from checkpoint
      const result1 = await context.step("s1", async () => {
        executedSteps.push("s1");
        return "should-not-run";
      });

      // Step 2 has no checkpoint data - mode transitions to ExecutionMode
      // The step function executes freshly
      const result2 = await context.step("s2", async () => {
        executedSteps.push("s2");
        return "freshly-executed";
      });

      expect(result1).toBe("cached-1");
      expect(result2).toBe("freshly-executed");
      // Only step 2 should have been executed
      expect(executedSteps).toEqual(["s2"]);
    });

    it("property: mode transitions at the correct boundary for any number of checkpointed steps", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 6 }), // number of checkpointed steps
          fc.integer({ min: 1, max: 3 }), // number of new steps after checkpoint boundary
          async (numCheckpointed, numNew) => {
            // Create checkpoint data for the first numCheckpointed steps
            const existingOperations = Array.from(
              { length: numCheckpointed },
              (_, i) => ({
                Id: hashId(`${i + 1}`),
                Type: OperationType.STEP,
                StartTimestamp: new Date(),
                Status: OperationStatus.SUCCEEDED,
                StepDetails: {
                  Result: JSON.stringify(`cached-${i + 1}`),
                },
              }),
            );

            const { context } = createTestDurableContext({
              durableExecutionMode: DurableExecutionMode.ReplayMode,
              existingOperations,
            });

            const executedSteps: string[] = [];

            // Execute checkpointed steps - should replay from cache
            for (let i = 0; i < numCheckpointed; i++) {
              const result = await context.step(`replayed-${i}`, async () => {
                executedSteps.push(`replayed-${i}`);
                return `should-not-run-${i}`;
              });
              expect(result).toBe(`cached-${i + 1}`);
            }

            // Execute new steps after boundary - should execute freshly
            for (let i = 0; i < numNew; i++) {
              const expectedValue = `fresh-value-${i}`;
              const result = await context.step(`fresh-${i}`, async () => {
                executedSteps.push(`fresh-${i}`);
                return expectedValue;
              });
              expect(result).toBe(expectedValue);
            }

            // Only the "fresh" steps should have been executed
            expect(executedSteps.length).toBe(numNew);
            for (let i = 0; i < numNew; i++) {
              expect(executedSteps).toContain(`fresh-${i}`);
            }
          },
        ),
        { numRuns: 20 },
      );
    });
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Property: Real operations after other real operations (no virtual contexts)
   * correctly align step IDs with checkpoint data.
   */
  describe("Step counter alignment for real-only operation sequences", () => {
    it("should correctly align step IDs across mixed step and runInChildContext operations", async () => {
      // Create checkpoint data matching what step -> childContext -> step would produce
      const existingOperations = [
        {
          Id: hashId("1"),
          Type: OperationType.STEP,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          StepDetails: { Result: JSON.stringify("v1") },
        },
        {
          Id: hashId("2"),
          Type: OperationType.CONTEXT,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          ContextDetails: { Result: JSON.stringify("child-result") },
        },
        {
          Id: hashId("2-1"),
          Type: OperationType.STEP,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          StepDetails: { Result: JSON.stringify("inner-value") },
        },
        {
          Id: hashId("3"),
          Type: OperationType.STEP,
          StartTimestamp: new Date(),
          Status: OperationStatus.SUCCEEDED,
          StepDetails: { Result: JSON.stringify("v3") },
        },
      ];

      const { context } = createTestDurableContext({
        durableExecutionMode: DurableExecutionMode.ReplayMode,
        existingOperations,
      });

      // Track execution to verify replay
      const executed: string[] = [];

      // Step 1 → replays from checkpoint
      const r1 = await context.step("step-1", async () => {
        executed.push("step-1");
        return "should-not-run";
      });
      expect(r1).toBe("v1");

      // Non-virtual child context → gets step ID "2", child step gets "2-1"
      const r2 = await context.runInChildContext("child", async (childCtx) => {
        const inner = await childCtx.step("inner", async () => {
          executed.push("inner");
          return "should-not-run-inner";
        });
        return inner;
      });
      // Child context replays - result from checkpoint (ContextDetails.Result)
      expect(r2).toBe("child-result");

      // Step 3 → replays from checkpoint (step ID "3" aligns correctly)
      const r3 = await context.step("step-3", async () => {
        executed.push("step-3");
        return "should-not-run-3";
      });
      expect(r3).toBe("v3");

      // No step functions should have been called (all replay)
      expect(executed).toEqual([]);
    });

    it("property: interleaved steps and non-virtual child contexts maintain alignment", async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate a sequence of operations: true = step, false = childContext with 1 step
          fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }),
          async (opSequence) => {
            // Build expected step IDs
            let stepCounter = 0;
            const operations: Array<{
              id: string;
              type: "step" | "context";
              childIds?: string[];
            }> = [];

            for (const isStep of opSequence) {
              stepCounter++;
              if (isStep) {
                operations.push({
                  id: `${stepCounter}`,
                  type: "step",
                });
              } else {
                operations.push({
                  id: `${stepCounter}`,
                  type: "context",
                  childIds: [`${stepCounter}-1`],
                });
              }
            }

            // Create checkpoint data for all expected operations
            const existingOperations = operations.flatMap((op) => {
              const ops: any[] = [
                {
                  Id: hashId(op.id),
                  Type:
                    op.type === "step"
                      ? OperationType.STEP
                      : OperationType.CONTEXT,
                  StartTimestamp: new Date(),
                  Status: OperationStatus.SUCCEEDED,
                  ...(op.type === "step"
                    ? {
                        StepDetails: {
                          Result: JSON.stringify(`result-${op.id}`),
                        },
                      }
                    : {
                        ContextDetails: {
                          Result: JSON.stringify(`result-${op.id}`),
                        },
                      }),
                },
              ];
              if (op.childIds) {
                for (const childId of op.childIds) {
                  ops.push({
                    Id: hashId(childId),
                    Type: OperationType.STEP,
                    StartTimestamp: new Date(),
                    Status: OperationStatus.SUCCEEDED,
                    StepDetails: {
                      Result: JSON.stringify(`result-${childId}`),
                    },
                  });
                }
              }
              return ops;
            });

            const { context } = createTestDurableContext({
              durableExecutionMode: DurableExecutionMode.ReplayMode,
              existingOperations,
            });

            const executed: string[] = [];

            // Execute the same sequence and verify replay works
            for (let i = 0; i < opSequence.length; i++) {
              if (opSequence[i]) {
                const result = await context.step(`s-${i}`, async () => {
                  executed.push(`s-${i}`);
                  return `should-not-run`;
                });
                // Should get cached value
                expect(result).toBe(`result-${i + 1}`);
              } else {
                const result = await context.runInChildContext(
                  `c-${i}`,
                  async (childCtx) => {
                    const inner = await childCtx.step(
                      `inner-${i}`,
                      async () => {
                        executed.push(`inner-${i}`);
                        return `should-not-run`;
                      },
                    );
                    return inner;
                  },
                );
                // Should get cached context result (from ContextDetails.Result)
                expect(result).toBe(`result-${i + 1}`);
              }
            }

            // No step functions should have been called (all replay)
            expect(executed).toEqual([]);
          },
        ),
        { numRuns: 20 },
      );
    });
  });
});
