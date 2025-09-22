import { createCallback } from "./callback";
import { ExecutionContext } from "../../types";
import { createCheckpoint } from "../../utils/checkpoint/checkpoint";
import { TerminationReason } from "../../termination-manager/types";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import { createMockExecutionContext } from "../../testing/mock-context";

describe("Callback Handler Promise Interface", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: ReturnType<typeof createCheckpoint>;
  let createStepId: () => string;
  let stepIdCounter: number;

  beforeEach(() => {
    stepIdCounter = 0;
    createStepId = () => `step-${++stepIdCounter}`;

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
    it("should support instanceof Promise check", async () => {
      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
      );

      const [promise] = await callbackHandler<string>("test-callback");

      // This should return true now
      expect(promise instanceof Promise).toBe(true);
    });

    it("should support .catch() method and terminate when called", async () => {
      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
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

      // Should return a promise
      expect(catchPromise instanceof Promise).toBe(true);
    });

    it("should support .finally() method and terminate when called", async () => {
      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
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
      );

      const [promise] = await callbackHandler<string>("test-callback");

      // This should not throw a compilation error and should trigger termination
      const asyncFunction = async () => {
        try {
          await promise; // This should trigger termination
        } catch (error) {
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

      // Clean up the hanging promise
      asyncPromise.catch(() => {}); // Prevent unhandled promise rejection
    }, 1000); // Set a reasonable timeout
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

    it("should support instanceof Promise for started callbacks", async () => {
      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
      );

      // Force the step ID to be "step-1" to match our mock
      stepIdCounter = 0;
      const [promise] = await callbackHandler<string>("test-callback");

      expect(promise instanceof Promise).toBe(true);
    });

    it("should support .catch() for started callbacks", async () => {
      const callbackHandler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
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
      );

      stepIdCounter = 0;
      const [promise] = await callbackHandler<string>("test-callback");

      expect(typeof promise.finally).toBe("function");

      const finallyPromise = promise.finally(() => {});
      expect(finallyPromise instanceof Promise).toBe(true);
    });
  });
});
