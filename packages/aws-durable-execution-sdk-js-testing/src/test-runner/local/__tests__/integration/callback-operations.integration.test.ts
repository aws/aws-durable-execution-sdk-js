import { LocalDurableTestRunner } from "../../local-durable-test-runner";
import { WaitingOperationStatus } from "../../../durable-test-runner";
import {
  DurableContext,
  withDurableFunctions,
} from "aws-durable-execution-sdk-js";
import { OperationType } from "@aws-sdk/client-lambda";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

/**
 * Integration tests for callback operations in LocalDurableTestRunner
 * Tests the complete callback workflow including creation, waiting, and completion.
 */
describe("Callback Operations Integration", () => {
  it("should handle callback operations with success completion", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        // Create callback - returns [promise, callbackId]
        const [callbackPromise, callbackId] = await context.createCallback(
          "external-api-call",
          {
            timeout: 300, // 5 minutes
            heartbeatTimeout: 60, // 1 minute
          }
        );

        // The execution will pause here until callback is completed
        const callbackResult = await callbackPromise;

        return {
          callbackResult,
          callbackId, // for verification
          completed: true,
        };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    // Get the callback operation before running
    const callbackOperation = runner.getOperation("external-api-call");

    // Start the execution (this will pause at the callback)
    const executionPromise = runner.run({
      payload: { test: "callback-operations" },
    });

    // Wait for the callback operation to be started
    const callbackData = await callbackOperation.waitForData(
      WaitingOperationStatus.STARTED
    );

    // Verify callback was created correctly
    expect(callbackData.getCallbackDetails()?.callbackId).toBeDefined();

    // Simulate external system completing the callback
    await callbackOperation.sendCallbackSuccess("payment_completed_pay_12345");

    // Now the execution should complete
    const result = await executionPromise;

    expect(result.getResult()).toEqual({
      callbackResult: "payment_completed_pay_12345",
      callbackId: expect.any(String),
      completed: true,
    });

    // Verify the callback operation was tracked
    const completedOperations = result.getOperations();
    expect(completedOperations.length).toEqual(1);
    expect(completedOperations[0].getType()).toBe(OperationType.CALLBACK);
  });

  it("should handle callback operations with failure", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        try {
          const [callbackPromise] = await context.createCallback(
            "failing-operation",
            {
              timeout: 60,
            }
          );

          await callbackPromise;
          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    const callbackOperation = runner.getOperation("failing-operation");

    const executionPromise = runner.run();

    // Wait for callback to start
    await callbackOperation.waitForData(WaitingOperationStatus.STARTED);

    // Send callback failure
    await callbackOperation.sendCallbackFailure({
      ErrorMessage: "External API failure",
      ErrorType: "APIException",
    });

    const result = await executionPromise;

    // TODO: update with actual error message when language sdk is updated to use it
    expect(result.getResult()).toEqual({
      success: false,
      error: "Callback failed",
    });
    // expect(result.getResult()).toEqual({
    //   success: false,
    //   error: "External API failure",
    // });
  });

  // todo: should use time skipping instead of real timers to reduce the length of this test
  it("should handle callback heartbeats", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        const [callbackPromise] = await context.createCallback(
          "long-running-task",
          {
            heartbeatTimeout: 1,
          }
        );

        const result = await callbackPromise;
        return { longTaskResult: result };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
    });

    const callbackOperation = runner.getOperation("long-running-task");

    const executionPromise = runner.run();

    // Wait for callback to start
    await callbackOperation.waitForData();

    // Wait more than half a second
    await new Promise((resolve) => setTimeout(resolve, 600));
    // Heartbeat sent, so it should not time out
    await callbackOperation.sendCallbackHeartbeat();
    // Wait more than half a second
    await new Promise((resolve) => setTimeout(resolve, 600));

    const callbackResult = JSON.stringify({
      processed: 1000,
      status: "completed",
    });

    // Finally complete the callback
    await callbackOperation.sendCallbackSuccess(callbackResult);

    const result = await executionPromise;

    expect(result.getResult()).toEqual({
      longTaskResult: callbackResult,
    });
  });

  // todo: enable test when language SDK handles timeouts
  it.skip("should time out if there are no callback heartbeats", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        const [callbackPromise] = await context.createCallback(
          "long-running-task",
          {
            heartbeatTimeout: 1,
          }
        );

        const result = await callbackPromise;
        return { longTaskResult: result };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
    });

    const result = await runner.run();

    expect(result.getError()).toBe({
      ErrorMessage: "",
    });
  });

  // todo: enable test when language SDK handles timeouts
  it.skip("should time out if callback times out", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        const [callbackPromise] = await context.createCallback(
          "long-running-task",
          {
            timeout: 1,
          }
        );

        const result = await callbackPromise;
        return { longTaskResult: result };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
    });

    const result = await runner.run();

    expect(result.getError()).toBe({
      ErrorMessage: "",
    });
  });

  it("should handle multiple concurrent callback operations", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        // Start multiple callbacks concurrently
        const [promise1] = await context.createCallback("api-call-1", {
          timeout: 300,
        });
        const [promise2] = await context.createCallback("api-call-2", {
          timeout: 300,
        });
        const [promise3] = await context.createCallback("api-call-3", {
          timeout: 300,
        });

        const [result1, result2, result3] = await Promise.all([
          promise1,
          promise2,
          promise3,
        ]);

        return {
          results: [result1, result2, result3],
          allCompleted: true,
        };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    // Get all callback operations
    const callback1 = runner.getOperation("api-call-1");
    const callback2 = runner.getOperation("api-call-2");
    const callback3 = runner.getOperation("api-call-3");

    const executionPromise = runner.run();

    // Wait for all callbacks to start
    await Promise.all([
      callback1.waitForData(WaitingOperationStatus.STARTED),
      callback2.waitForData(WaitingOperationStatus.STARTED),
      callback3.waitForData(WaitingOperationStatus.STARTED),
    ]);

    // Complete callbacks in different order
    const callbackResult2 = JSON.stringify({
      id: 2,
      data: "second",
    });
    await callback2.sendCallbackSuccess(callbackResult2);
    const callbackResult1 = JSON.stringify({
      id: 1,
      data: "first",
    });
    await callback1.sendCallbackSuccess(callbackResult1);
    const callbackResult3 = JSON.stringify({
      id: 3,
      data: "third",
    });
    await callback3.sendCallbackSuccess(callbackResult3);

    const result = await executionPromise;

    expect(result.getResult()).toEqual({
      results: [callbackResult1, callbackResult2, callbackResult3],
      allCompleted: true,
    });

    // Verify all callback operations were tracked
    const completedOperations = result.getOperations();
    expect(completedOperations.length).toEqual(3);
    expect(
      completedOperations.every((op) => op.getType() === OperationType.CALLBACK)
    ).toBe(true);
  });

  it("should handle callback operations mixed with other operation types", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        // Mix callback with step and wait operations
        await context.wait("initial-wait", 100);

        const stepResult = await context.step("fetch-data", () => {
          return Promise.resolve({ userId: 123, name: "John Doe" });
        });

        const [callbackPromise] = await context.createCallback("process-user", {
          timeout: 300,
        });

        const callbackResult = await callbackPromise;

        return {
          stepResult,
          callbackResult,
          completed: true,
        };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    const callbackOperation = runner.getOperation("process-user");

    const executionPromise = runner.run();

    // Wait for callback to start (other operations complete synchronously)
    await callbackOperation.waitForData(WaitingOperationStatus.STARTED);

    // Complete the callback
    const callbackResult = JSON.stringify({
      processed: true,
      timestamp: Date.now(),
    });
    await callbackOperation.sendCallbackSuccess(callbackResult);

    const result = await executionPromise;

    expect(result.getResult()).toEqual({
      stepResult: { userId: 123, name: "John Doe" },
      callbackResult: callbackResult,
      completed: true,
    });

    // Verify all operations were tracked
    const completedOperations = result.getOperations();
    expect(completedOperations.length).toEqual(3);

    const operationTypes = completedOperations.map((op) => op.getType());
    expect(operationTypes).toContain(OperationType.WAIT);
    expect(operationTypes).toContain(OperationType.STEP);
    expect(operationTypes).toContain(OperationType.CALLBACK);
  });

  it("should handle callback operations with custom serdes", async () => {
    interface CustomData {
      id: number;
      message: string;
      timestamp: Date;
    }

    const customSerdes = {
      serialize: async (
        data: CustomData | undefined
      ): Promise<string | undefined> => {
        if (data === undefined) return Promise.resolve(undefined);
        return Promise.resolve(
          JSON.stringify({
            ...data,
            timestamp: data.timestamp.toISOString(),
          })
        );
      },
      deserialize: async (
        str: string | undefined
      ): Promise<CustomData | undefined> => {
        if (str === undefined) return Promise.resolve(undefined);
        const parsed = JSON.parse(str) as {
          id: number;
          message: string;
          timestamp: string;
        };
        return Promise.resolve({
          ...parsed,
          timestamp: new Date(parsed.timestamp),
        });
      },
    };

    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        const [callbackPromise] = await context.createCallback<CustomData>(
          "custom-serdes-callback",
          {
            timeout: 300,
            serdes: customSerdes,
          }
        );

        const result = await callbackPromise;
        return {
          receivedData: result,
          isDateObject: result.timestamp instanceof Date,
        };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    const callbackOperation = runner.getOperation("custom-serdes-callback");
    const executionPromise = runner.run();

    await callbackOperation.waitForData(WaitingOperationStatus.STARTED);

    // Send data that requires custom serialization
    const testData: CustomData = {
      id: 42,
      message: "Hello World",
      timestamp: new Date("2025-01-01T00:00:00Z"),
    };

    const serializedData = await customSerdes.serialize(testData);
    await callbackOperation.sendCallbackSuccess(serializedData!);

    const result = await executionPromise;

    expect(result.getResult()).toEqual(
      JSON.parse(
        // the result will always get stringified regardless since it's the lambda response
        JSON.stringify({
          receivedData: testData,
          isDateObject: true,
        })
      )
    );
  });
});
