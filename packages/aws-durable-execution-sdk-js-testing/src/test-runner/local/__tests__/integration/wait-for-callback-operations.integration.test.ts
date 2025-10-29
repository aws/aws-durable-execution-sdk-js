import { LocalDurableTestRunner } from "../../local-durable-test-runner";
import { WaitingOperationStatus } from "../../../durable-test-runner";
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { OperationStatus } from "@aws-sdk/client-lambda";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

/**
 * Integration tests for waitForCallback operations in LocalDurableTestRunner
 * Tests the complete waitForCallback workflow including submitter execution and callback completion.
 */
describe("WaitForCallback Operations Integration", () => {
  // Concurrent and Complex Workflow Tests Category
  describe("Concurrent and Complex Workflow Tests", () => {
    // todo: add test when language SDK adds concurrency support
    it.skip("should handle multiple concurrent waitForCallback operations with different submitters", async () => {
      let callback1Id: string | undefined;
      let callback2Id: string | undefined;
      let callback3Id: string | undefined;

      const handler = withDurableExecution<unknown, unknown>(
        async (_event: unknown, context: DurableContext) => {
          // Start multiple waitForCallback operations concurrently
          const parallelResult = await context.parallel([
            (childContext) =>
              childContext.waitForCallback<{ id: number; data: string }>(
                "wait-for-callback",
                async (callbackId) => {
                  callback1Id = callbackId;
                  // Simulate different submitter behavior for each callback
                  await new Promise((resolve) => setTimeout(resolve, 10));
                  return Promise.resolve();
                },
              ),
            (childContext) =>
              childContext.waitForCallback<{ id: number; data: string }>(
                "wait-for-callback",
                async (callbackId) => {
                  callback2Id = callbackId;
                  // Different submitter with longer setup time
                  await new Promise((resolve) => setTimeout(resolve, 20));
                  return Promise.resolve();
                },
              ),
            (childContext) =>
              childContext.waitForCallback<{ id: number; data: string }>(
                "wait-for-callback",
                (callbackId) => {
                  callback3Id = callbackId;
                  // Synchronous submitter
                  return Promise.resolve();
                },
              ),
          ]);

          const [result1, result2, result3] = parallelResult
            .getResults()
            .map((result) => result.data);

          return {
            results: [result1, result2, result3],
            callbackIds: [callback1Id, callback2Id, callback3Id],
            allCompleted: true,
          };
        },
      );

      const runner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
      });

      // Get all callback operations by index
      const callback1Op = runner.getOperationByNameAndIndex<{
        id: number;
        data: string;
      }>("wait-for-callback", 0);
      const callback2Op = runner.getOperationByNameAndIndex<{
        id: number;
        data: string;
      }>("wait-for-callback", 1);
      const callback3Op = runner.getOperationByNameAndIndex<{
        id: number;
        data: string;
      }>("wait-for-callback", 2);

      const executionPromise = runner.run({
        payload: { test: "concurrent-waitForCallback" },
      });

      // Wait for all callbacks to start
      await Promise.all([
        callback1Op.waitForData(WaitingOperationStatus.STARTED),
        callback2Op.waitForData(WaitingOperationStatus.STARTED),
        callback3Op.waitForData(WaitingOperationStatus.STARTED),
      ]);

      // Complete callbacks in different order to test concurrency
      const callback2Result = JSON.stringify({
        id: 2,
        data: "second-completed",
      });
      const callback1Result = JSON.stringify({
        id: 1,
        data: "first-completed",
      });
      const callback3Result = JSON.stringify({
        id: 3,
        data: "third-completed",
      });

      await callback2Op.sendCallbackSuccess(callback2Result);
      await callback1Op.sendCallbackSuccess(callback1Result);
      await callback3Op.sendCallbackSuccess(callback3Result);

      const result = await executionPromise;

      expect(result.getResult()).toEqual({
        results: [
          { id: 1, data: "first-completed" },
          { id: 2, data: "second-completed" },
          { id: 3, data: "third-completed" },
        ],
        callbackIds: [
          expect.any(String),
          expect.any(String),
          expect.any(String),
        ],
        allCompleted: true,
      });

      // Verify all callback operations were tracked
      const completedOperations = result.getOperations({
        status: OperationStatus.SUCCEEDED,
      });
      expect(completedOperations.length).toBeGreaterThan(2);

      // Verify all callback IDs are unique
      expect(callback1Id).toBeDefined();
      expect(callback2Id).toBeDefined();
      expect(callback3Id).toBeDefined();
      expect(new Set([callback1Id, callback2Id, callback3Id]).size).toBe(3);
    });

    it("should handle multiple invocations tracking with waitForCallback operations", async () => {
      let firstCallbackId: string | undefined;
      let secondCallbackId: string | undefined;

      const handler = withDurableExecution<unknown, unknown>(
        async (_event: unknown, context: DurableContext) => {
          await context.wait("wait-invocation-1", 1);

          const callbackResult1 = await context.waitForCallback<{
            step: number;
          }>("first-callback", async (callbackId) => {
            firstCallbackId = callbackId;
            return Promise.resolve();
          });

          const stepResult = await context.step("process-callback-data", () => {
            return Promise.resolve({ processed: true, step: 1 });
          });

          await context.wait("wait-invocation-2", 1);

          const callbackResult2 = await context.waitForCallback<{
            step: number;
          }>("second-callback", async (callbackId) => {
            secondCallbackId = callbackId;
            return Promise.resolve();
          });

          // Final invocation returns result
          return {
            firstCallback: callbackResult1,
            secondCallback: callbackResult2,
            stepResult,
            callbackIds: [firstCallbackId, secondCallbackId],
          };
        },
      );

      const runner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
      });

      // Get operations for verification
      const firstCallbackOp = runner.getOperation<{ step: number }>(
        "first-callback",
      );
      const secondCallbackOp = runner.getOperation<{ step: number }>(
        "second-callback",
      );

      const executionPromise = runner.run({
        payload: { test: "multiple-invocations" },
      });

      // Wait for first callback and complete it
      await firstCallbackOp.waitForData(WaitingOperationStatus.STARTED);
      const firstCallbackResult = JSON.stringify({ step: 1 });
      await firstCallbackOp.sendCallbackSuccess(firstCallbackResult);

      // Wait for second callback and complete it
      await secondCallbackOp.waitForData(WaitingOperationStatus.STARTED);
      const secondCallbackResult = JSON.stringify({ step: 2 });
      await secondCallbackOp.sendCallbackSuccess(secondCallbackResult);

      const result = await executionPromise;

      expect(result.getResult()).toEqual({
        firstCallback: '{"step":1}',
        secondCallback: '{"step":2}',
        stepResult: { processed: true, step: 1 },
        callbackIds: [expect.any(String), expect.any(String)],
      });

      // Verify invocations were tracked - should be exactly 3 invocations
      const invocations = result.getInvocations();
      expect(invocations).toHaveLength(5);

      // Verify operations distribution across invocations
      const invocationOperations = invocations.map(
        (inv) => inv.getOperations().length,
      );

      expect(invocationOperations).toHaveLength(5);

      // Invocation 0: wait
      expect(invocationOperations[0]).toBe(1);
      // Invocation 1: callback context, callback, submitter
      expect(invocationOperations[1]).toBe(3);
      // Invocation 2: previous callback context, step, wait
      expect(invocationOperations[2]).toBe(3);
      // Invocation 3: new callback context, callback, submitter
      expect(invocationOperations[3]).toBe(3);
      // Invocation 4: previous callback context
      expect(invocationOperations[4]).toBe(1);

      // Verify callback IDs are unique
      expect(firstCallbackId).toBeDefined();
      expect(secondCallbackId).toBeDefined();
      expect(firstCallbackId).not.toBe(secondCallbackId);
    });
  });

  describe("Error Handling & Submitter Function Variants", () => {
    it("should handle waitForCallback with submitter function synchronous errors", async () => {
      const handler = withDurableExecution<unknown, unknown>(
        async (_event: unknown, context: DurableContext) => {
          try {
            const result = await context.waitForCallback<{ data: string }>(
              () => {
                throw new Error("Submitter failed immediately");
              },
            );

            return {
              callbackResult: result,
              success: true,
            };
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
      );

      const runner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
      });

      const result = await runner.run({
        payload: { test: "submitter-sync-error" },
      });

      expect(result.getResult()).toEqual({
        success: false,
        error: "Submitter failed immediately",
      });

      // Should have no succeeded operations since submitter failed before callback was created
      const succeededOperations = result.getOperations({
        status: OperationStatus.SUCCEEDED,
      });
      expect(succeededOperations.length).toEqual(0);
    });

    it("should handle waitForCallback with submitter function returning rejected promises", async () => {
      const handler = withDurableExecution<unknown, unknown>(
        async (_event: unknown, context: DurableContext) => {
          try {
            const result = await context.waitForCallback<{ data: string }>(
              () => {
                return Promise.reject(new Error("Async submitter failure"));
              },
            );

            return {
              callbackResult: result,
              success: true,
            };
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
      );

      const runner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
      });

      const result = await runner.run({
        payload: { test: "submitter-async-error" },
      });

      expect(result.getResult()).toEqual({
        success: false,
        error: "Async submitter failure",
      });

      // Should have no succeeded operations since submitter failed
      const succeededOperations = result.getOperations({
        status: OperationStatus.SUCCEEDED,
      });
      expect(succeededOperations.length).toEqual(0);
    });
  });

  it("should handle waitForCallback with complex submitter function errors", async () => {
    let callbackId: string | undefined;
    let sideEffectCounter = 0;

    const handler = withDurableExecution<unknown, unknown>(
      async (_event: unknown, context: DurableContext) => {
        try {
          const result = await context.waitForCallback<{ data: string }>(
            async (id) => {
              callbackId = id;

              // Simulate complex submitter that performs multiple operations
              sideEffectCounter++;

              // First async operation succeeds
              await new Promise((resolve) => setTimeout(resolve, 10));
              sideEffectCounter++;

              // Second async operation succeeds
              await Promise.resolve({ step: 1 });
              sideEffectCounter++;

              // Third operation fails
              throw new Error("Complex submitter failed at step 3");
            },
            {
              retryStrategy: (_, attemptCount) => ({
                shouldRetry: attemptCount < 3,
                delaySeconds: 1,
              }),
            },
          );

          return {
            callbackResult: result,
            success: true,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            sideEffects: sideEffectCounter,
            callbackId: callbackId,
          };
        }
      },
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    const result = await runner.run({
      payload: { test: "complex-submitter-error" },
    });

    expect(result.getResult()).toEqual({
      success: false,
      error: "Complex submitter failed at step 3",
      // Retries 6 times (default maxAttempts)
      sideEffects: 18,
      callbackId: expect.any(String),
    });

    // Verify that callback ID was generated before failure
    expect(callbackId).toBeDefined();
    expect(sideEffectCounter).toBe(18);

    // Should have no succeeded operations since submitter failed
    const completedOperations = result.getOperations({
      status: OperationStatus.SUCCEEDED,
    });
    expect(completedOperations.length).toEqual(0);
  });
});
