import { createCallback } from "./callback";
import { ExecutionContext } from "../../types";
import { createCheckpoint } from "../../utils/checkpoint/checkpoint";
import { TerminationReason } from "../../termination-manager/types";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import { createMockExecutionContext } from "../../testing/mock-context";
import { OperationStatus } from "@aws-sdk/client-lambda";
import { createErrorObjectFromError } from "../../utils/error-object/error-object";

describe("Callback Handler Promise Interface", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: ReturnType<typeof createCheckpoint>;
  let createStepId: () => string;
  let stepIdCounter: number;
  let mockHasRunningOperations: jest.Mock;

  beforeEach(() => {
    stepIdCounter = 0;
    createStepId = (): string => `step-${++stepIdCounter}`;
    mockHasRunningOperations = jest.fn().mockReturnValue(false);

    mockContext = createMockExecutionContext();

    // Mock checkpoint to simulate callback creation
    const mockCheckpointFn = jest.fn().mockImplementation(async (stepId) => {
      // Simulate the API response by updating stepData
      const hashedStepId = hashId(stepId) as any;
      mockContext._stepData[hashedStepId] = {
        Status: "STARTED" as any,
        CallbackDetails: {
          CallbackId: `callback-${stepId}`,
        },
      };
    });
    mockCheckpoint = Object.assign(mockCheckpointFn, {
      force: jest.fn().mockResolvedValue(undefined),
    }) as any;
  });

  describe("Promise Interface Compliance", () => {
    it("should not support instanceof Promise check", async () => {
      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      const [promise] = await callbackHandler<string>("test-callback");

      expect(promise instanceof Promise).toBe(false);
    });

    it("should support .catch() method and terminate when called", async () => {
      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      const [promise] = await callbackHandler<string>("test-callback");

      // Should have catch method
      expect(typeof promise.catch).toBe("function");

      // Calling catch should trigger termination
      const catchPromise = promise.catch(() => {});

      expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CALLBACK_PENDING,
        message:
          "Callback test-callback created and pending external completion",
      });

      expect(catchPromise instanceof Promise).toBe(true);
    });

    it("should support .finally() method and terminate when called", async () => {
      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      const [promise] = await callbackHandler<string>("test-callback");

      // Should have finally method
      expect(typeof promise.finally).toBe("function");

      // Calling finally should trigger termination
      const finallyPromise = promise.finally(() => {});

      expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CALLBACK_PENDING,
        message:
          "Callback test-callback created and pending external completion",
      });

      // Should return a promise
      expect(finallyPromise instanceof Promise).toBe(true);
    });

    it("should support .then() method and terminate when called", async () => {
      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      const [promise] = await callbackHandler<string>("test-callback");

      // Should have then method
      expect(typeof promise.then).toBe("function");

      // Calling then should trigger termination
      const thenPromise = promise.then(() => {});

      expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CALLBACK_PENDING,
        message:
          "Callback test-callback created and pending external completion",
      });

      // Should return a promise
      expect(thenPromise instanceof Promise).toBe(true);
    });

    it("should work with Promise.resolve() and Promise.all()", async () => {
      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      const [promise] = await callbackHandler<string>("test-callback");

      // Should work with Promise static methods
      expect(() => Promise.resolve(promise)).not.toThrow();
      expect(() => Promise.all([promise])).not.toThrow();

      // These should return promises
      expect(Promise.resolve(promise) instanceof Promise).toBe(true);
      expect(Promise.all([promise]) instanceof Promise).toBe(true);
    });

    it("should work with async/await syntax", async () => {
      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      const [promise] = await callbackHandler<string>("test-callback");

      // This should not throw a compilation error and should trigger termination
      const asyncFunction = async (): Promise<void> => {
        try {
          await promise; // This should trigger termination
        } catch (_error) {
          // Handle error
        }
      };

      expect(() => asyncFunction()).not.toThrow();

      // Start the async function but don't wait for it to complete
      // since it will never resolve (which is the expected behavior)
      const asyncPromise = asyncFunction();

      // Give it a moment to trigger the termination
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CALLBACK_PENDING,
        message:
          "Callback test-callback created and pending external completion",
      });

      asyncPromise.catch(() => {}); // Prevent unhandled promise rejection
    }, 1000);
  });

  describe("await with completed vs pending callbacks", () => {
    it("should resolve normally with await when callback result exists", async () => {
      // Mock a completed callback with result
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      const expectedResult = "callback-result";

      mockContext._stepData[hashedStepId] = {
        Status: OperationStatus.SUCCEEDED,
        CallbackDetails: {
          CallbackId: "callback-123",
          Result: expectedResult,
        },
      };

      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      stepIdCounter = 0; // Reset to ensure we get step-1
      const [promise] = await callbackHandler<string>("test-callback");

      const asyncFunction = async (): Promise<string> => {
        try {
          const result = await promise; // This should resolve immediately
          return result;
        } catch {
          return "error caught";
        }
      };

      const result = await asyncFunction();

      // Should resolve with the actual result, not terminate
      expect(result).toBe(expectedResult);
      expect(mockContext.terminationManager.terminate).not.toHaveBeenCalled();
    });

    it("should reject normally when callback failed", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      const errorMessage = "Callback failed";

      mockContext._stepData[hashedStepId] = {
        Status: OperationStatus.FAILED,
        CallbackDetails: {
          CallbackId: "callback-123",
          Error: createErrorObjectFromError(new Error(errorMessage)),
        },
      };

      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      stepIdCounter = 0;
      const [promise] = await callbackHandler<string>("test-callback");

      const asyncFunction = async (): Promise<string> => {
        try {
          await promise;
          return "try: success";
        } catch (error) {
          return `catch: ${error instanceof Error ? error.message : String(error)}`;
        }
      };

      const result = await asyncFunction();

      expect(result).toBe(`catch: ${errorMessage}`);
      expect(mockContext.terminationManager.terminate).not.toHaveBeenCalled();
    });

    it("should handle mixed pending and completed callbacks correctly", async () => {
      // Setup one completed callback
      const completedStepId = "step-1";
      const completedHashedStepId = hashId(completedStepId);
      mockContext._stepData[completedHashedStepId] = {
        Status: OperationStatus.SUCCEEDED,
        CallbackDetails: {
          CallbackId: "callback-completed",
          Result: "completed-result",
        },
      };

      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      // Create completed callback (step-1)
      stepIdCounter = 0;
      const [completedPromise] =
        await callbackHandler<string>("completed-callback");

      // Create pending callback (step-2)
      const [pendingPromise] =
        await callbackHandler<string>("pending-callback");

      const asyncFunction = async (): Promise<string> => {
        try {
          // First await should resolve immediately
          const completedResult = await completedPromise;

          // Second await should terminate (never reached)
          const pendingResult = await pendingPromise;
          return `${completedResult},${pendingResult}`;
        } catch {
          return "error";
        }
      };

      const asyncPromise = asyncFunction();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should have terminated on the second await (pending callback)
      expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CALLBACK_PENDING,
        message:
          "Callback pending-callback created and pending external completion",
      });

      asyncPromise.catch(() => {}); // Prevent unhandled promise rejection
    });

    it("should handle failed callback with .then() and only success handler", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      const errorMessage = "Callback failed";

      mockContext._stepData[hashedStepId] = {
        Status: OperationStatus.FAILED,
        CallbackDetails: {
          CallbackId: "callback-123",
          Error: createErrorObjectFromError(new Error(errorMessage)),
        },
      };

      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      stepIdCounter = 0;
      const [promise] = await callbackHandler<string>("test-callback");

      // Call .then() with only success handler (no rejection handler)
      const thenPromise = promise.then((result) => `Success: ${result}`);

      // Should reject with CallbackError, not resolve with success message
      await expect(thenPromise).rejects.toThrow("Callback failed");
      expect(mockContext.terminationManager.terminate).not.toHaveBeenCalled();
    });

    it("should handle failed callback with .then() and both handlers", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      const errorMessage = "Callback failed";

      mockContext._stepData[hashedStepId] = {
        Status: OperationStatus.FAILED,
        CallbackDetails: {
          CallbackId: "callback-123",
          Error: createErrorObjectFromError(new Error(errorMessage)),
        },
      };

      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      stepIdCounter = 0;
      const [promise] = await callbackHandler<string>("test-callback");

      // Call .then() with both success and rejection handlers
      const thenPromise = promise.then(
        (result) => `Success: ${result}`,
        (error) => `Handled error: ${error.message}`,
      );

      // Should call rejection handler and resolve with handled error message
      const result = await thenPromise;
      expect(result).toBe(`Handled error: ${errorMessage}`);
      expect(mockContext.terminationManager.terminate).not.toHaveBeenCalled();
    });

    it("should not cause unhandled promise rejections for failed callbacks", async () => {
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      const errorMessage = "Callback failed";

      mockContext._stepData[hashedStepId] = {
        Status: OperationStatus.FAILED,
        CallbackDetails: {
          CallbackId: "callback-123",
          Error: createErrorObjectFromError(new Error(errorMessage)),
        },
      };

      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      stepIdCounter = 0;
      const [promise] = await callbackHandler<string>("test-callback");

      // Track unhandled rejections
      const unhandledRejections: any[] = [];
      const testHandler = (reason: any): void => {
        unhandledRejections.push(reason);
      };

      process.on("unhandledRejection", testHandler);

      try {
        // These operations should not cause unhandled rejections
        promise.then(() => {}).catch(() => {}); // Handled
        promise.catch(() => {}); // Handled
        promise.finally(() => {}).catch(() => {}); // Handled

        // Wait a bit to see if any unhandled rejections occur
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Should not have any unhandled rejections
        expect(unhandledRejections).toHaveLength(0);
      } finally {
        // Clean up the test handler
        process.removeListener("unhandledRejection", testHandler);
      }
    });
  });

  describe("Started Callback Promise Interface", () => {
    beforeEach(() => {
      // Mock a started callback
      const stepId = "step-1";
      const hashedStepId = hashId(stepId);
      mockContext._stepData[hashedStepId] = {
        Status: "STARTED" as any,
        CallbackDetails: {
          CallbackId: "callback-123",
        },
      };
    });

    it("should not support instanceof Promise for started callbacks", async () => {
      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      // Force the step ID to be "step-1" to match our mock
      stepIdCounter = 0;
      const [promise] = await callbackHandler<string>("test-callback");

      expect(promise instanceof Promise).toBe(false);
      expect(String(promise)).toBe("[object TerminatingPromise]");
    });

    it("should support .catch() for started callbacks", async () => {
      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      stepIdCounter = 0;
      const [promise] = await callbackHandler<string>("test-callback");

      expect(typeof promise.catch).toBe("function");

      const catchPromise = promise.catch(() => {});
      expect(catchPromise instanceof Promise).toBe(true);
    });

    it("should support .finally() for started callbacks", async () => {
      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      stepIdCounter = 0;
      const [promise] = await callbackHandler<string>("test-callback");

      expect(typeof promise.finally).toBe("function");

      const finallyPromise = promise.finally(() => {});
      expect(finallyPromise instanceof Promise).toBe(true);
    });
  });
});
