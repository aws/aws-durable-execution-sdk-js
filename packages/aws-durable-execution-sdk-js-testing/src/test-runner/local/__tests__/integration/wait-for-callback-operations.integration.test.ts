import { LocalDurableTestRunner } from "../../local-durable-test-runner";
import { WaitingOperationStatus } from "../../../durable-test-runner";
import {
  DurableContext,
  withDurableFunctions,
} from "@aws/durable-execution-sdk-js";
import { OperationStatus } from "@aws-sdk/client-lambda";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

/**
 * Integration tests for waitForCallback operations in LocalDurableTestRunner
 * Tests the complete waitForCallback workflow including submitter execution and callback completion.
 */
describe("WaitForCallback Operations Integration", () => {
  it("should handle basic waitForCallback with anonymous submitter", async () => {
    let receivedCallbackId: string | undefined;

    const handler = withDurableFunctions<unknown, unknown>(
      async (_event: unknown, context: DurableContext) => {
        const result = await context.waitForCallback<{ data: string }>(
          async (callbackId) => {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            receivedCallbackId = callbackId;
            return Promise.resolve();
          },
        );

        return {
          callbackResult: result,
          submitterReceived: (receivedCallbackId?.length ?? 0) > 0,
          completed: true,
        };
      },
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    // Start the execution (this will pause at the callback)
    const executionPromise = runner.run({
      payload: { test: "waitForCallback-anonymous" },
    });

    const callbackOperation = runner.getOperationByIndex<{ data: string }>(1);

    // Wait for the operation to be available
    await callbackOperation.waitForData(WaitingOperationStatus.STARTED);
    const callbackResult = JSON.stringify({
      data: "callback_completed",
    });
    // Simulate external system completing the callback
    await callbackOperation.sendCallbackSuccess(callbackResult);

    // Now the execution should complete
    const result = await executionPromise;

    expect(result.getResult()).toEqual({
      callbackResult: callbackResult,
      submitterReceived: true,
      completed: true,
    });
    expect(receivedCallbackId).toBeDefined();
  });

  it("should handle basic waitForCallback with named submitter", async () => {
    let receivedCallbackId: string | undefined; // simulates a side-effect since it's outside the handler
    const handler = withDurableFunctions<unknown, unknown>(
      async (_event: unknown, context: DurableContext) => {
        const result = await context.waitForCallback<{ data: string }>(
          async (callbackId) => {
            receivedCallbackId = callbackId;
            return Promise.resolve();
          },
        );

        return {
          callbackResult: result,
          completed: true,
          callbackId: receivedCallbackId,
        };
      },
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    // Start the execution (this will pause at the callback)
    const executionPromise = runner.run();

    const callbackOperation = runner.getOperationByIndex<{ data: string }>(1);

    // Wait for the operation to be available
    await callbackOperation.waitForData(WaitingOperationStatus.STARTED);
    // Simulate external system completing the callback
    const callbackResult = JSON.stringify({
      data: "callback_completed",
    });
    await callbackOperation.sendCallbackSuccess(callbackResult);

    // Now the execution should complete
    const result = await executionPromise;

    const callbackDetails = callbackOperation.getCallbackDetails();
    expect(result.getResult()).toEqual({
      callbackResult,
      completed: true,
      callbackId: callbackDetails?.callbackId,
    });
  });

  // Error Handling & Submitter Function Variants Category
  describe("Error Handling & Submitter Function Variants", () => {
    it("should handle waitForCallback with submitter function synchronous errors", async () => {
      const handler = withDurableFunctions<unknown, unknown>(
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
      const handler = withDurableFunctions<unknown, unknown>(
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

    it("should handle waitForCallback with callback failure scenarios", async () => {
      let receivedCallbackId: string | undefined;

      const handler = withDurableFunctions<unknown, unknown>(
        async (_event: unknown, context: DurableContext) => {
          try {
            const result = await context.waitForCallback<{ data: string }>(
              async (callbackId) => {
                receivedCallbackId = callbackId;
                await new Promise((resolve) => setTimeout(resolve, 1000));
                // Submitter succeeds - simulates successful external API call setup
                return Promise.resolve();
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
              callbackId: receivedCallbackId,
            };
          }
        },
      );

      const runner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
      });

      // Start the execution (this will pause at the callback)
      const executionPromise = runner.run({
        payload: { test: "callback-failure" },
      });

      const callbackOperation = runner.getOperationByIndex<{ data: string }>(1);

      // Wait for the operation to be available (submitter succeeded)
      await callbackOperation.waitForData(WaitingOperationStatus.STARTED);

      // Simulate external system failing the callback
      await callbackOperation.sendCallbackFailure({
        ErrorMessage: "External API failure",
        ErrorType: "APIException",
      });

      const result = await executionPromise;

      expect(result.getResult()).toEqual({
        success: false,
        error: "Callback failed",
        callbackId: receivedCallbackId,
      });

      expect(receivedCallbackId).toBeDefined();

      const completedOperations = result.getOperations();
      expect(completedOperations.length).toEqual(3);
    });

    it("should handle waitForCallback mixed success/failure scenarios", async () => {
      let scenario1CallbackId: string | undefined;
      let scenario2CallbackId: string | undefined;

      // Test scenario where submitter fails but callback would have succeeded
      const handler1 = withDurableFunctions<unknown, unknown>(
        async (_event: unknown, context: DurableContext) => {
          try {
            const result = await context.waitForCallback<{ data: string }>(
              (callbackId) => {
                scenario1CallbackId = callbackId;
                // Simulate submitter that fails after receiving callback ID
                throw new Error("Submitter failed after callback creation");
              },
            );

            return { success: true, result };
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : String(error),
              scenario: "submitter-fails-after-callback-creation",
            };
          }
        },
      );

      const runner1 = new LocalDurableTestRunner({
        handlerFunction: handler1,
        skipTime: true,
      });

      const result1 = await runner1.run({
        payload: { test: "mixed-scenario-1" },
      });

      expect(result1.getResult()).toEqual({
        success: false,
        error: "Submitter failed after callback creation",
        scenario: "submitter-fails-after-callback-creation",
      });

      // Test scenario where submitter succeeds but callback fails (covered in previous test)
      // This test demonstrates the contrast between the two scenarios
      const handler2 = withDurableFunctions<unknown, unknown>(
        async (_event: unknown, context: DurableContext) => {
          const result = await context.waitForCallback<{ data: string }>(
            (callbackId) => {
              scenario2CallbackId = callbackId;
              // Submitter succeeds
              return Promise.resolve();
            },
          );

          return {
            success: true,
            result,
            scenario: "submitter-succeeds-callback-succeeds",
          };
        },
      );

      const runner2 = new LocalDurableTestRunner({
        handlerFunction: handler2,
        skipTime: true,
      });

      const executionPromise2 = runner2.run({
        payload: { test: "mixed-scenario-2" },
      });

      const callbackOperation2 = runner2.getOperationByIndex<{ data: string }>(
        1,
      );
      await callbackOperation2.waitForData(WaitingOperationStatus.STARTED);

      const callbackResult = JSON.stringify({ data: "success-data" });
      await callbackOperation2.sendCallbackSuccess(callbackResult);

      const result2 = await executionPromise2;

      expect(result2.getResult()).toEqual({
        success: true,
        result: callbackResult,
        scenario: "submitter-succeeds-callback-succeeds",
      });

      expect(scenario1CallbackId).toBeDefined();
      expect(scenario2CallbackId).toBeDefined();
    });

    it("should handle waitForCallback with complex submitter function errors", async () => {
      let callbackId: string | undefined;
      let sideEffectCounter = 0;

      const handler = withDurableFunctions<unknown, unknown>(
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
        // Retries 3 times
        sideEffects: 9,
        callbackId: expect.any(String),
      });

      // Verify that callback ID was generated before failure
      expect(callbackId).toBeDefined();
      expect(sideEffectCounter).toBe(9);

      // Should have no succeeded operations since submitter failed
      const completedOperations = result.getOperations({
        status: OperationStatus.SUCCEEDED,
      });
      expect(completedOperations.length).toEqual(0);
    });
  });

  // Timeout and Heartbeat Tests Category
  describe("Timeout and Heartbeat Tests", () => {
    it("should handle waitForCallback with heartbeat timeout configuration", async () => {
      let receivedCallbackId: string | undefined;

      const handler = withDurableFunctions<unknown, unknown>(
        async (_event: unknown, context: DurableContext) => {
          const result = await context.waitForCallback<{ data: string }>(
            async (callbackId) => {
              receivedCallbackId = callbackId;
              // Submitter succeeds - simulates external API call setup
              return Promise.resolve();
            },
            {
              heartbeatTimeout: 2, // 2 seconds heartbeat timeout
              timeout: 300, // 5 minute total timeout
            },
          );

          return {
            callbackResult: result,
            heartbeatEnabled: true,
            completed: true,
          };
        },
      );

      const runner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
      });

      // Start the execution (this will pause at the callback)
      const executionPromise = runner.run({
        payload: { test: "heartbeat-timeout-config" },
      });

      const callbackOperation = runner.getOperationByIndex<{ data: string }>(1);

      // Wait for the operation to be available
      await callbackOperation.waitForData(WaitingOperationStatus.STARTED);

      // Verify callback details include timeout configuration
      const callbackDetails = callbackOperation.getCallbackDetails();
      expect(callbackDetails?.callbackId).toBeDefined();

      const callbackResult = JSON.stringify({
        data: "heartbeat-completed",
      });
      // Complete the callback successfully
      await callbackOperation.sendCallbackSuccess(callbackResult);

      const result = await executionPromise;

      expect(result.getResult()).toEqual({
        callbackResult: callbackResult,
        heartbeatEnabled: true,
        completed: true,
      });

      expect(receivedCallbackId).toBeDefined();

      // Should have completed operations with successful callback
      const completedOperations = result.getOperations({
        status: OperationStatus.SUCCEEDED,
      });
      expect(completedOperations.length).toBeGreaterThan(0);
    });

    it("should handle waitForCallback heartbeat scenarios during long-running submitter execution", async () => {
      let receivedCallbackId: string | undefined;
      let submitterStartTime: number;
      let submitterEndTime: number;

      const handler = withDurableFunctions<unknown, unknown>(
        async (_event: unknown, context: DurableContext) => {
          const result = await context.waitForCallback<{ processed: number }>(
            async (callbackId) => {
              receivedCallbackId = callbackId;
              submitterStartTime = Date.now();

              // Simulate long-running submitter function
              // In real scenario, this would be setting up external systems
              await new Promise((resolve) => setTimeout(resolve, 100));

              submitterEndTime = Date.now();
              return Promise.resolve();
            },
            {
              heartbeatTimeout: 1, // 1 second heartbeat timeout
            },
          );

          return {
            callbackResult: result,
            submitterDuration: submitterEndTime - submitterStartTime,
            callbackId: receivedCallbackId,
          };
        },
      );

      const runner = new LocalDurableTestRunner({
        handlerFunction: handler,
      }); // Use real time for this test to demonstrate heartbeat behavior

      const executionPromise = runner.run({
        payload: { test: "heartbeat-long-submitter" },
      });

      const callbackOperation = runner.getOperationByIndex<{
        processed: number;
      }>(1);

      // Wait for the operation to be available (submitter completes)
      await callbackOperation.waitForData(WaitingOperationStatus.STARTED);

      // Send heartbeat to keep the callback alive during processing
      await callbackOperation.sendCallbackHeartbeat();

      // Wait a bit more to simulate processing time
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Send another heartbeat
      await callbackOperation.sendCallbackHeartbeat();

      // Finally complete the callback
      const callbackResult = JSON.stringify({
        processed: 1000,
      });
      await callbackOperation.sendCallbackSuccess(callbackResult);

      const result = await executionPromise;

      const resultData = result.getResult() as {
        callbackResult: string;
        submitterDuration: number;
        callbackId: string;
      };

      expect(resultData.callbackResult).toEqual(callbackResult);
      expect(resultData.submitterDuration).toBeGreaterThan(50); // Should take at least 100ms
      expect(resultData.callbackId).toBeDefined();

      // Should have completed operations with successful callback
      const completedOperations = result.getOperations({
        status: OperationStatus.SUCCEEDED,
      });
      expect(completedOperations.length).toBeGreaterThan(0);
    });

    it("should handle waitForCallback timeout scenarios", async () => {
      const handler = withDurableFunctions<unknown, unknown>(
        async (_event: unknown, context: DurableContext) => {
          try {
            const result = await context.waitForCallback<{ data: string }>(
              async () => {
                // Submitter succeeds but callback never completes
                return Promise.resolve();
              },
              {
                timeout: 1, // 1 second timeout
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
      });

      const result = await runner.run({
        payload: { test: "timeout-scenario" },
      });

      expect(result.getResult()).toEqual({
        success: false,
        error: "Callback failed",
      });
    });
  });

  // Concurrent and Complex Workflow Tests Category
  describe("Concurrent and Complex Workflow Tests", () => {
    // todo: add test when language SDK adds concurrency support
    it.skip("should handle multiple concurrent waitForCallback operations with different submitters", async () => {
      let callback1Id: string | undefined;
      let callback2Id: string | undefined;
      let callback3Id: string | undefined;

      const handler = withDurableFunctions<unknown, unknown>(
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

    it("should handle waitForCallback mixed with steps, waits, and other operations", async () => {
      let callbackId: string | undefined;

      const handler = withDurableFunctions<unknown, unknown>(
        async (_event: unknown, context: DurableContext) => {
          // Mix waitForCallback with other operation types
          await context.wait("initial-wait", 50);

          const stepResult = await context.step("fetch-user-data", () => {
            return Promise.resolve({ userId: 123, name: "John Doe" });
          });

          const callbackResult = await context.waitForCallback<{
            processed: boolean;
          }>("wait-for-callback", async (id) => {
            callbackId = id;
            // Submitter uses data from previous step
            await new Promise((resolve) => setTimeout(resolve, 10));
            return Promise.resolve();
          });

          await context.wait("final-wait", 25);

          const finalStep = await context.step("finalize-processing", () => {
            return Promise.resolve({
              status: "completed",
              timestamp: Date.now(),
            });
          });

          return {
            stepResult,
            callbackResult,
            finalStep,
            callbackId,
            workflowCompleted: true,
          };
        },
      );

      const runner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
      });

      const callbackOperation = runner.getOperation<{
        processed: boolean;
      }>("wait-for-callback");

      const executionPromise = runner.run({
        payload: { test: "mixed-operations" },
      });

      // Wait for callback to start (other operations complete synchronously with skipTime)
      await callbackOperation.waitForData(WaitingOperationStatus.STARTED);

      // Complete the callback
      const callbackResult = JSON.stringify({ processed: true });
      await callbackOperation.sendCallbackSuccess(callbackResult);

      const result = await executionPromise;

      const resultData = result.getResult() as {
        stepResult: { userId: number; name: string };
        callbackResult: { processed: boolean };
        finalStep: { status: string; timestamp: number };
        callbackId: string;
        workflowCompleted: boolean;
      };

      expect(resultData).toMatchObject({
        stepResult: { userId: 123, name: "John Doe" },
        callbackResult: JSON.stringify({ processed: true }),
        finalStep: { status: "completed" },
        workflowCompleted: true,
      });
      expect(resultData.callbackId).toBeDefined();
      expect(typeof resultData.finalStep.timestamp).toBe("number");

      // Verify all operations were tracked - should have wait, step, waitForCallback (context + callback + submitter), wait, step
      const completedOperations = result.getOperations({
        status: OperationStatus.SUCCEEDED,
      });
      expect(completedOperations.length).toBe(7);
    });

    it("should handle waitForCallback within child contexts", async () => {
      let parentCallbackId: string | undefined;
      let childCallbackId: string | undefined;

      const handler = withDurableFunctions<unknown, unknown>(
        async (_event: unknown, context: DurableContext) => {
          const parentResult = await context.waitForCallback<{
            parentData: string;
          }>("parent-callback-op", async (callbackId) => {
            parentCallbackId = callbackId;
            return Promise.resolve();
          });

          const childContextResult = await context.runInChildContext(
            "child-context-with-callback",
            async (childContext) => {
              await childContext.wait("child-wait", 100);

              const childCallbackResult = await childContext.waitForCallback<{
                childData: number;
              }>("child-callback-op", async (callbackId) => {
                childCallbackId = callbackId;
                return Promise.resolve();
              });

              return {
                childResult: childCallbackResult,
                childProcessed: true,
              };
            },
          );

          return {
            parentResult,
            childContextResult,
            callbackIds: {
              parent: parentCallbackId,
              child: childCallbackId,
            },
          };
        },
      );

      const runner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
      });

      // Get operations - parent callback, child context, child wait, child callback
      const parentCallbackOp = runner.getOperation<{
        parentData: string;
      }>("parent-callback-op");
      const childContextOp = runner.getOperation("child-context-with-callback");
      const childCallbackOp = runner.getOperation<{ childData: number }>(
        "child-callback-op",
      );

      const executionPromise = runner.run({
        payload: { test: "child-context-callbacks" },
      });

      // Wait for parent callback to start
      await parentCallbackOp.waitForData(WaitingOperationStatus.STARTED);
      const parentCallbackResult = JSON.stringify({
        parentData: "parent-completed",
      });
      await parentCallbackOp.sendCallbackSuccess(parentCallbackResult);

      // Wait for child callback to start
      await childCallbackOp.waitForData(WaitingOperationStatus.STARTED);
      const childCallbackResult = JSON.stringify({ childData: 42 });
      await childCallbackOp.sendCallbackSuccess(childCallbackResult);

      const result = await executionPromise;

      expect(result.getResult()).toEqual({
        parentResult: parentCallbackResult,
        childContextResult: {
          childResult: childCallbackResult,
          childProcessed: true,
        },
        callbackIds: {
          parent: expect.any(String),
          child: expect.any(String),
        },
      });

      // Verify child operations are accessible
      const childOperations = childContextOp.getChildOperations();
      expect(childOperations).toHaveLength(2); // wait + waitForCallback

      // Verify unique callback IDs
      expect(parentCallbackId).toBeDefined();
      expect(childCallbackId).toBeDefined();
      expect(parentCallbackId).not.toBe(childCallbackId);

      const completedOperations = result.getOperations({
        status: OperationStatus.SUCCEEDED,
      });
      expect(completedOperations.length).toBe(8);
    });

    it("should handle multiple invocations tracking with waitForCallback operations", async () => {
      let firstCallbackId: string | undefined;
      let secondCallbackId: string | undefined;

      const handler = withDurableFunctions<unknown, unknown>(
        async (_event: unknown, context: DurableContext) => {
          await context.wait("wait-invocation-1", 1000);

          const callbackResult1 = await context.waitForCallback<{
            step: number;
          }>("first-callback", async (callbackId) => {
            firstCallbackId = callbackId;
            return Promise.resolve();
          });

          const stepResult = await context.step("process-callback-data", () => {
            return Promise.resolve({ processed: true, step: 1 });
          });

          await context.wait("wait-invocation-2", 1000);

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

    it("should handle nested waitForCallback operations in child contexts", async () => {
      let outerCallbackId: string | undefined;
      let innerCallbackId: string | undefined;
      let nestedCallbackId: string | undefined;

      const handler = withDurableFunctions<unknown, unknown>(
        async (_event: unknown, context: DurableContext) => {
          const outerResult = await context.waitForCallback<{ level: string }>(
            "outer-callback-op",
            async (callbackId) => {
              outerCallbackId = callbackId;
              return Promise.resolve();
            },
          );

          const nestedResult = await context.runInChildContext(
            "outer-child-context",
            async (outerChildContext) => {
              const innerResult = await outerChildContext.waitForCallback<{
                level: string;
              }>("inner-callback-op", async (callbackId) => {
                innerCallbackId = callbackId;
                return Promise.resolve();
              });

              // Nested child context with another callback
              const deepNestedResult =
                await outerChildContext.runInChildContext(
                  "inner-child-context",
                  async (innerChildContext) => {
                    await innerChildContext.wait("deep-wait", 50);

                    const nestedCallbackResult =
                      await innerChildContext.waitForCallback<{
                        level: string;
                      }>("nested-callback-op", async (callbackId) => {
                        nestedCallbackId = callbackId;
                        return Promise.resolve();
                      });

                    return {
                      nestedCallback: nestedCallbackResult,
                      deepLevel: "inner-child",
                    };
                  },
                );

              return {
                innerCallback: innerResult,
                deepNested: deepNestedResult,
                level: "outer-child",
              };
            },
          );

          return {
            outerCallback: outerResult,
            nestedResults: nestedResult,
            allCallbackIds: {
              outer: outerCallbackId,
              inner: innerCallbackId,
              nested: nestedCallbackId,
            },
          };
        },
      );

      const runner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
      });

      // Get operations - outer callback, outer context, inner callback, inner context, deep wait, nested callback
      const outerCallbackOp = runner.getOperation<{ level: string }>(
        "outer-callback-op",
      );
      const outerContextOp = runner.getOperation("outer-child-context");
      const innerCallbackOp = runner.getOperation<{ level: string }>(
        "inner-callback-op",
      );
      const innerContextOp = runner.getOperation("inner-child-context");
      const nestedCallbackOp = runner.getOperation<{ level: string }>(
        "nested-callback-op",
      );

      const executionPromise = runner.run({
        payload: { test: "nested-child-callbacks" },
      });

      // Complete callbacks in sequence
      await outerCallbackOp.waitForData(WaitingOperationStatus.STARTED);
      const outerCallbackResult = JSON.stringify({ level: "outer-completed" });
      await outerCallbackOp.sendCallbackSuccess(outerCallbackResult);

      await innerCallbackOp.waitForData(WaitingOperationStatus.STARTED);
      const innerCallbackResult = JSON.stringify({ level: "inner-completed" });
      await innerCallbackOp.sendCallbackSuccess(innerCallbackResult);

      await nestedCallbackOp.waitForData(WaitingOperationStatus.STARTED);
      const nestedCallbackResult = JSON.stringify({
        level: "nested-completed",
      });
      await nestedCallbackOp.sendCallbackSuccess(nestedCallbackResult);

      const result = await executionPromise;

      expect(result.getResult()).toEqual({
        outerCallback: outerCallbackResult,
        nestedResults: {
          innerCallback: innerCallbackResult,
          deepNested: {
            nestedCallback: nestedCallbackResult,
            deepLevel: "inner-child",
          },
          level: "outer-child",
        },
        allCallbackIds: {
          outer: expect.any(String),
          inner: expect.any(String),
          nested: expect.any(String),
        },
      });

      // Verify child operations hierarchy
      const outerChildren = outerContextOp.getChildOperations();
      expect(outerChildren).toHaveLength(2); // inner callback + inner context

      const innerChildren = innerContextOp.getChildOperations();
      expect(innerChildren).toHaveLength(2); // deep wait + nested callback

      // Verify all callback IDs are unique
      expect(outerCallbackId).toBeDefined();
      expect(innerCallbackId).toBeDefined();
      expect(nestedCallbackId).toBeDefined();
      expect(
        new Set([outerCallbackId, innerCallbackId, nestedCallbackId]).size,
      ).toBe(3);

      // Should have tracked all operations
      const completedOperations = result.getOperations();
      expect(completedOperations.length).toBe(12);
    });
  });

  // Advanced Configuration Tests Category
  describe("Advanced Configuration Tests", () => {
    it("should handle waitForCallback with custom timeout settings", async () => {
      let receivedCallbackId: string | undefined;

      const handler = withDurableFunctions<unknown, unknown>(
        async (_event: unknown, context: DurableContext) => {
          const result = await context.waitForCallback<{ data: string }>(
            "custom-timeout-callback",
            async (callbackId) => {
              receivedCallbackId = callbackId;
              return Promise.resolve();
            },
            {
              timeout: 120, // 2 minutes custom timeout
              heartbeatTimeout: 5, // 5 seconds heartbeat timeout
            },
          );

          return {
            callbackResult: result,
            timeoutConfigured: true,
            callbackId: receivedCallbackId,
          };
        },
      );

      const runner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
      });

      const executionPromise = runner.run({
        payload: { test: "custom-timeout-config" },
      });

      const callbackOperation = runner.getOperation<{ data: string }>(
        "custom-timeout-callback",
      );

      // Wait for the operation to be available
      await callbackOperation.waitForData(WaitingOperationStatus.STARTED);

      // Verify callback details include custom timeout configuration
      const callbackDetails = callbackOperation.getCallbackDetails();
      expect(callbackDetails?.callbackId).toBeDefined();

      // Complete the callback successfully
      const customTimeoutResult = JSON.stringify({
        data: "custom-timeout-completed",
      });
      await callbackOperation.sendCallbackSuccess(customTimeoutResult);

      const result = await executionPromise;

      expect(result.getResult()).toEqual({
        callbackResult: customTimeoutResult,
        timeoutConfigured: true,
        callbackId: expect.any(String),
      });

      expect(receivedCallbackId).toBeDefined();

      // Should have completed operations with successful callback
      const completedOperations = result.getOperations({
        status: OperationStatus.SUCCEEDED,
      });
      expect(completedOperations.length).toBeGreaterThan(0);
    });

    it("should handle waitForCallback with custom serdes configuration", async () => {
      interface CustomData {
        id: number;
        message: string;
        timestamp: Date;
        metadata: {
          version: string;
          processed: boolean;
        };
      }

      const customSerdes = {
        serialize: async (
          data: CustomData | undefined,
        ): Promise<string | undefined> => {
          if (data === undefined) return Promise.resolve(undefined);
          return Promise.resolve(
            JSON.stringify({
              ...data,
              timestamp: data.timestamp.toISOString(),
              _serializedBy: "custom-serdes-v1",
            }),
          );
        },
        deserialize: async (
          str: string | undefined,
        ): Promise<CustomData | undefined> => {
          if (str === undefined) return Promise.resolve(undefined);
          const parsed = JSON.parse(str) as {
            id: number;
            message: string;
            timestamp: string;
            metadata: {
              version: string;
              processed: boolean;
            };
            _serializedBy: string;
          };
          return Promise.resolve({
            id: parsed.id,
            message: parsed.message,
            timestamp: new Date(parsed.timestamp),
            metadata: parsed.metadata,
          });
        },
      };

      let receivedCallbackId: string | undefined;
      let submitterData: CustomData | undefined;

      const handler = withDurableFunctions<unknown, unknown>(
        async (_event: unknown, context: DurableContext) => {
          const result = await context.waitForCallback<CustomData>(
            "custom-serdes-callback",
            async (callbackId) => {
              receivedCallbackId = callbackId;
              // Submitter can access the custom data type
              submitterData = {
                id: 999,
                message: "submitter-data",
                timestamp: new Date("2025-01-01T00:00:00Z"),
                metadata: {
                  version: "1.0.0",
                  processed: false,
                },
              };
              return Promise.resolve();
            },
            {
              serdes: customSerdes,
              timeout: 300,
            },
          );

          return {
            receivedData: result,
            submitterData,
            isDateObject: result.timestamp instanceof Date,
            serdesUsed: true,
          };
        },
      );

      const runner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
      });

      const executionPromise = runner.run({
        payload: { test: "custom-serdes" },
      });

      const callbackOperation = runner.getOperation<CustomData>(
        "custom-serdes-callback",
      );

      await callbackOperation.waitForData(WaitingOperationStatus.STARTED);

      // Send data that requires custom serialization
      const testData: CustomData = {
        id: 42,
        message: "Hello Custom Serdes",
        timestamp: new Date("2025-06-15T12:30:45Z"),
        metadata: {
          version: "2.0.0",
          processed: true,
        },
      };

      // Serialize the data using custom serdes for sending
      const serializedData = await customSerdes.serialize(testData);
      await callbackOperation.sendCallbackSuccess(serializedData!);

      const result = await executionPromise;

      expect(result.getResult()).toEqual(
        JSON.parse(
          // the result will always get stringified since it's the lambda response
          JSON.stringify({
            receivedData: testData,
            submitterData: submitterData,
            isDateObject: true,
            serdesUsed: true,
          }),
        ),
      );

      expect(receivedCallbackId).toBeDefined();

      // Should have completed operations with successful callback
      const completedOperations = result.getOperations({
        status: OperationStatus.SUCCEEDED,
      });
      expect(completedOperations.length).toBeGreaterThan(0);
    });
  });

  describe("Mocking Tests", () => {
    it("should handle basic waitForCallback mocking functionality", async () => {
      const handler = withDurableFunctions<unknown, unknown>(
        async (_event: unknown, context: DurableContext) => {
          const result1 = await context.waitForCallback<{ data: string }>(
            "mock-callback-1",
            async () => {
              // This submitter function should be mocked
              return Promise.resolve();
            },
          );

          const result2 = await context.waitForCallback<{ processed: boolean }>(
            "mock-callback-2",
            async () => {
              // This submitter function should be replaced by mockImplementation
              return Promise.resolve();
            },
          );

          return {
            firstResult: result1,
            secondResult: result2,
            completed: true,
          };
        },
      );

      const runner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
      });

      const mockCallback1 = runner.getOperation<{ data: string }>(
        "mock-callback-1",
      );
      const mockCallback2 = runner.getOperation<{ processed: boolean }>(
        "mock-callback-2",
      );

      // Mock the first callback with mockResolvedValue
      mockCallback1.mockResolvedValue({ data: "mocked-data-1" });

      // Mock the second callback with mockImplementation
      mockCallback2.mockImplementation(() =>
        Promise.resolve({ processed: true }),
      );

      const result = await runner.run({
        payload: { test: "basic-mocking" },
      });

      expect(result.getResult()).toEqual({
        firstResult: { data: "mocked-data-1" },
        secondResult: { processed: true },
        completed: true,
      });

      // Should have completed operations since mocks were used
      const completedOperations = result.getOperations({
        status: OperationStatus.SUCCEEDED,
      });
      expect(completedOperations.length).toBeGreaterThan(0);
    });

    it("should handle waitForCallback error mocking", async () => {
      const handler = withDurableFunctions<unknown, unknown>(
        async (_event: unknown, context: DurableContext) => {
          try {
            const result = await context.waitForCallback<{ data: string }>(
              "failing-callback",
              async () => {
                // This should be mocked to fail
                return Promise.resolve();
              },
            );

            return { result, success: true };
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

      const failingCallback = runner.getOperation<{ data: string }>(
        "failing-callback",
      );
      failingCallback.mockRejectedValue(new Error("Mocked callback failure"));

      const result = await runner.run({
        payload: { test: "error-mocking" },
      });

      expect(result.getResult()).toEqual({
        success: false,
        error: "Mocked callback failure",
      });

      const completedOperations = result.getOperations();
      expect(completedOperations.length).toBeGreaterThan(0);
    });
  });
});
