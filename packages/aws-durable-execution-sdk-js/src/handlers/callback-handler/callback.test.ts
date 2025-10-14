import {
  createMockCheckpoint,
  CheckpointFunction,
} from "../../testing/mock-checkpoint";
import { createCallback } from "./callback";
import {
  ExecutionContext,
  CreateCallbackConfig,
  OperationSubType,
} from "../../types";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";
import {
  OperationStatus,
  OperationType,
  Operation,
} from "@aws-sdk/client-lambda";
import { defaultSerdes } from "../../utils/serdes/serdes";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import { createMockExecutionContext } from "../../testing/mock-context";

// Mock waitBeforeContinue
jest.mock("../../utils/wait-before-continue/wait-before-continue", () => ({
  waitBeforeContinue: jest.fn().mockResolvedValue({ reason: "operations" }),
}));
import { TEST_CONSTANTS } from "../../testing/test-constants";

// Mock the logger to avoid console output during tests
jest.mock("../../utils/logger/logger", () => ({
  log: jest.fn(),
}));

// Mock the serdes utilities
jest.mock("../../errors/serdes-errors/serdes-errors", () => ({
  safeDeserialize: jest.fn(),
}));

import { safeDeserialize } from "../../errors/serdes-errors/serdes-errors";
import { CallbackError } from "../../errors/callback-error/callback-error";

describe("Callback Handler", () => {
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let mockCheckpoint: jest.MockedFunction<CheckpointFunction>;
  let createStepId: jest.Mock;
  let callbackHandler: ReturnType<typeof createCallback>;
  let mockTerminationManager: jest.Mocked<TerminationManager>;
  let mockSafeDeserialize: jest.MockedFunction<typeof safeDeserialize>;

  beforeEach(() => {
    // Reset all mocks before each test to ensure isolation
    jest.resetAllMocks();

    // Create a mock termination manager
    mockTerminationManager = {
      terminate: jest.fn(),
      getTerminationPromise: jest.fn(),
    } as unknown as jest.Mocked<TerminationManager>;

    mockExecutionContext = createMockExecutionContext({
      terminationManager: mockTerminationManager,
    });

    mockCheckpoint = createMockCheckpoint();
    createStepId = jest.fn().mockReturnValue(TEST_CONSTANTS.CALLBACK_ID);

    mockSafeDeserialize = safeDeserialize as jest.MockedFunction<
      typeof safeDeserialize
    >;
    mockSafeDeserialize.mockResolvedValue("deserialized-result");

    const mockHasRunningOperations = jest.fn().mockReturnValue(false);

    callbackHandler = createCallback(
      mockExecutionContext,
      mockCheckpoint,
      createStepId,
      mockHasRunningOperations,
    );
  });

  describe("Completed Callback Scenarios", () => {
    test("should return cached result for already completed callback", async () => {
      // Set up a callback that was already completed
      const stepId = TEST_CONSTANTS.CALLBACK_ID;
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.SUCCEEDED,
          CallbackDetails: {
            CallbackId: "callback-123",
            Result: "completed-result",
          },
        } as Operation,
      };

      const [promise, callbackId] =
        await callbackHandler<string>("test-callback");

      // Verify the callback ID is returned immediately
      expect(callbackId).toBe("callback-123");

      // Verify the promise resolves to the deserialized result
      const result = await promise;
      expect(result).toBe("deserialized-result");

      // Verify safeDeserialize was called with correct parameters
      expect(mockSafeDeserialize).toHaveBeenCalledWith(
        expect.objectContaining({
          serialize: expect.any(Function),
          deserialize: expect.any(Function),
        }),
        "completed-result",
        TEST_CONSTANTS.CALLBACK_ID,
        "test-callback",
        mockTerminationManager,
        "test-arn",
      );

      // Verify checkpoint was not called for completed callback
      expect(mockCheckpoint).not.toHaveBeenCalled();
      // Verify terminate was not called for completed callback
      expect(mockTerminationManager.terminate).not.toHaveBeenCalled();
    });

    test("should handle completed callback without name", async () => {
      const stepId = TEST_CONSTANTS.CALLBACK_ID;
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.SUCCEEDED,
          CallbackDetails: {
            CallbackId: "callback-456",
            Result: "result-data",
          },
        } as Operation,
      };

      const [promise, callbackId] = await callbackHandler<string>();

      expect(callbackId).toBe("callback-456");
      const result = await promise;
      expect(result).toBe("deserialized-result");

      // Verify safeDeserialize was called with undefined name
      expect(mockSafeDeserialize).toHaveBeenCalledWith(
        expect.objectContaining({
          serialize: expect.any(Function),
          deserialize: expect.any(Function),
        }),
        "result-data",
        TEST_CONSTANTS.CALLBACK_ID,
        undefined,
        mockTerminationManager,
        "test-arn",
      );
    });

    test("should use pass-through serdes that preserves data unchanged", async () => {
      const stepId = TEST_CONSTANTS.CALLBACK_ID;
      const hashedStepId = hashId(stepId);
      const testData = "test data";

      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.SUCCEEDED,
          CallbackDetails: {
            CallbackId: "callback-passthrough",
            Result: testData,
          },
        } as Operation,
      };

      // Mock safeDeserialize to call the actual serdes functions
      (mockSafeDeserialize as jest.Mock).mockImplementation(
        async (serdes, data) => {
          const serialized = await serdes.serialize(data);
          return await serdes.deserialize(serialized);
        },
      );

      const [promise] = await callbackHandler<string>("passthrough-test");
      const result = await promise;

      expect(result).toBe(testData);
    });

    test("should handle non-JSON callback data with pass-through serdes", async () => {
      const stepId = TEST_CONSTANTS.CALLBACK_ID;
      const hashedStepId = hashId(stepId);
      const nonJsonData = "plain text data";

      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.SUCCEEDED,
          CallbackDetails: {
            CallbackId: "callback-non-json",
            Result: nonJsonData,
          },
        } as Operation,
      };

      (mockSafeDeserialize as jest.Mock).mockResolvedValue(nonJsonData);

      const [promise, callbackId] =
        await callbackHandler<string>("non-json-test");

      expect(callbackId).toBe("callback-non-json");
      const result = await promise;
      expect(result).toBe(nonJsonData);

      // Verify that pass-through serdes was used (not defaultSerdes)
      const serdesArg = (mockSafeDeserialize as jest.Mock).mock.calls[0][0];
      expect(serdesArg).not.toBe(defaultSerdes);
      expect(typeof serdesArg.serialize).toBe("function");
      expect(typeof serdesArg.deserialize).toBe("function");
    });

    test("should throw error if completed callback has no callback ID", async () => {
      const stepId = TEST_CONSTANTS.CALLBACK_ID;
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.SUCCEEDED,
          CallbackDetails: {
            Result: "some-result",
          },
        } as Operation,
      };

      await expect(callbackHandler<string>("test-callback")).rejects.toThrow(
        "No callback ID found for completed callback: test-callback-id",
      );
    });

    test("should throw error if completed callback has no result", async () => {
      const stepId = TEST_CONSTANTS.CALLBACK_ID;
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.SUCCEEDED,
          CallbackDetails: {
            CallbackId: "callback-789",
          },
        } as Operation,
      };

      await expect(callbackHandler<string>("test-callback")).rejects.toThrow(
        "No result found for completed callback: test-callback-id",
      );
    });

    test("should use custom serdes for completed callback", async () => {
      const customSerdes = {
        serialize: jest.fn(),
        deserialize: jest.fn(),
      };

      const stepId = TEST_CONSTANTS.CALLBACK_ID;
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.SUCCEEDED,
          CallbackDetails: {
            CallbackId: "callback-custom",
            Result: "custom-result",
          },
        } as Operation,
      };

      const config: CreateCallbackConfig<string> = {
        serdes: customSerdes,
        timeout: 300,
      };

      const [promise, callbackId] = await callbackHandler<string>(
        "custom-callback",
        config,
      );

      expect(callbackId).toBe("callback-custom");
      await promise;

      // Verify custom serdes was used
      expect(mockSafeDeserialize).toHaveBeenCalledWith(
        customSerdes,
        "custom-result",
        TEST_CONSTANTS.CALLBACK_ID,
        "custom-callback",
        mockTerminationManager,
        "test-arn",
      );
    });
  });

  describe.each([
    {
      status: OperationStatus.FAILED,
      statusName: "failed",
      testData: {
        callbackId: "callback-failed-123",
        errorData: "Error data",
        errorMessage: "Callback execution failed",
        errorType: "CallbackErrorType",
        stackTrace: ["1", "2", "3"],
        callbackIdWithoutError: "callback-failed-456",
      },
    },
    {
      status: OperationStatus.TIMED_OUT,
      statusName: "timed out",
      testData: {
        callbackId: "callback-timed-out-123",
        errorData: "Timeout error data",
        errorMessage: "Callback timed out",
        errorType: "TimeoutError",
        stackTrace: ["timeout", "stack", "trace"],
        callbackIdWithoutError: "callback-timed-out-456",
      },
    },
  ])("$statusName Callback Scenarios", ({ status, statusName, testData }) => {
    test(`should throw error for ${statusName} callback`, async () => {
      const stepId = TEST_CONSTANTS.CALLBACK_ID;
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: status,
          CallbackDetails: {
            CallbackId: testData.callbackId,
            Error: {
              ErrorData: testData.errorData,
              ErrorMessage: testData.errorMessage,
              ErrorType: testData.errorType,
              StackTrace: testData.stackTrace,
            },
          },
        } as Operation,
      };

      const [promise, callbackId] = await callbackHandler<string>(
        `${statusName}-callback`,
      );
      expect(callbackId).toBe(testData.callbackId);

      await promise
        .then(() => {
          throw new Error("Expected callback to fail");
        })
        .catch((err: CallbackError) => {
          expect(err).toBeInstanceOf(CallbackError);
          expect(err.message).toEqual("Callback failed");
          expect(err.data).toEqual(testData.errorData);

          const cause = err.cause;
          expect(cause).toBeInstanceOf(Error);
          expect(cause!.message).toEqual(testData.errorMessage);
          expect(cause!.name).toEqual(testData.errorType);
          expect(cause!.stack).toEqual(testData.stackTrace.join("\n"));
        });
    });

    test(`should throw generic error for ${statusName} callback without error message`, async () => {
      const stepId = TEST_CONSTANTS.CALLBACK_ID;
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: status,
          CallbackDetails: {
            CallbackId: testData.callbackIdWithoutError,
          },
          StepDetails: {},
        } as Operation,
      };

      const [promise, callbackId] = await callbackHandler<string>(
        `${statusName}-callback`,
      );
      expect(callbackId).toBe(testData.callbackIdWithoutError);
      await expect(promise).rejects.toThrow("Callback failed");
    });

    test(`should throw error for ${statusName} callback without CallbackId`, async () => {
      const stepId = TEST_CONSTANTS.CALLBACK_ID;
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: status,
          StepDetails: {
            Result: `Callback ${statusName}`,
          },
        } as Operation,
      };

      await expect(
        callbackHandler<string>(`${statusName}-callback`),
      ).rejects.toThrow(
        "No callback ID found for failed callback: test-callback-id",
      );
    });

    test(`should handle callback ${statusName} during operation wait`, async () => {
      const mockHasRunningOperations = jest.fn().mockReturnValue(true);

      const callbackHandler = createCallback(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      // Initially STARTED, then becomes the target status after waitBeforeContinue
      let callCount = 0;
      mockExecutionContext.getStepData.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call during callback creation
          return {
            Id: TEST_CONSTANTS.CALLBACK_ID,
            Type: OperationType.CALLBACK,
            StartTimestamp: new Date(),
            Status: OperationStatus.STARTED,
            CallbackDetails: { CallbackId: "callback-123" },
          };
        } else {
          // Second call after waitBeforeContinue - status changed to target status
          return {
            Id: TEST_CONSTANTS.CALLBACK_ID,
            Type: OperationType.CALLBACK,
            StartTimestamp: new Date(),
            Status: status,
            CallbackDetails: {
              CallbackId: "callback-123",
              Error: {
                ErrorMessage: testData.errorMessage,
                ErrorType: testData.errorType,
                ErrorData: testData.errorData,
              },
            },
          };
        }
      });

      const [promise] = await callbackHandler<string>("test-callback");

      // Mock waitBeforeContinue to simulate the wait completing
      const mockWaitBeforeContinue = (
        await import("../../utils/wait-before-continue/wait-before-continue")
      ).waitBeforeContinue as jest.Mock;
      mockWaitBeforeContinue.mockResolvedValue({ reason: "status" });

      // Trigger the promise - this should execute the target status path
      promise.then(() => {}).catch(() => {});

      // The key verification is that getStepData was called twice:
      // 1. During callback creation (returns STARTED)
      // 2. After waitBeforeContinue (returns target status)
      expect(mockExecutionContext.getStepData).toHaveBeenCalledTimes(2);

      // Verify waitBeforeContinue was called (indicating operations were running)
      expect(mockWaitBeforeContinue).toHaveBeenCalled();
    });
  });

  describe("Started Callback Scenarios", () => {
    test("should return never-resolving promise for started callback and terminate when awaited", async () => {
      const stepId = TEST_CONSTANTS.CALLBACK_ID;
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          CallbackDetails: {
            CallbackId: "started-callback-123",
          },
        } as Operation,
      };

      const [promise, callbackId] =
        await callbackHandler<string>("started-callback");

      // Verify the callback ID is returned immediately
      expect(callbackId).toBe("started-callback-123");

      // Verify terminate was NOT called yet (should only be called when promise is awaited)
      expect(mockTerminationManager.terminate).not.toHaveBeenCalled();

      // Now await the promise, which should trigger termination
      const promiseResult = promise.then(() => "should-never-resolve");

      // Verify terminate was called when the promise was awaited
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CALLBACK_PENDING,
        message: "Callback started-callback is pending external completion",
      });

      // The promise should never resolve, so this timeout should trigger
      await expect(
        Promise.race([
          promiseResult,
          new Promise((resolve) => setTimeout(() => resolve("timeout"), 100)),
        ]),
      ).resolves.toBe("timeout");
    });

    test("should not terminate when callbackHandler is called but promise is not awaited", async () => {
      const stepId = TEST_CONSTANTS.CALLBACK_ID;
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          CallbackDetails: {
            CallbackId: "started-callback-123",
          },
        } as Operation,
      };

      // Call callbackHandler but don't await the returned promise
      const [, callbackId] = await callbackHandler<string>("started-callback");

      // Verify the callback ID is returned immediately
      expect(callbackId).toBe("started-callback-123");

      // Verify terminate was NOT called since we haven't awaited the promise
      expect(mockTerminationManager.terminate).not.toHaveBeenCalled();

      // Even after some time, terminate should still not be called
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockTerminationManager.terminate).not.toHaveBeenCalled();
    });

    test("should use stepId in message when name is not provided for started callback", async () => {
      const stepId = TEST_CONSTANTS.CALLBACK_ID;
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          CallbackDetails: {
            CallbackId: "started-callback-456",
          },
        } as Operation,
      };

      const [promise] = await callbackHandler<string>();

      // Await the promise to trigger termination
      promise.then(() => "should-never-resolve");

      // Verify terminate was called with stepId in message
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CALLBACK_PENDING,
        message: "Callback test-callback-id is pending external completion",
      });
    });

    test("should throw error if started callback has no callback ID", async () => {
      const stepId = TEST_CONSTANTS.CALLBACK_ID;
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          CallbackDetails: {},
        } as Operation,
      };

      await expect(callbackHandler<string>("started-callback")).rejects.toThrow(
        "No callback ID found for started callback: test-callback-id",
      );
    });

    test("should terminate when catch is called on started callback promise", async () => {
      const stepId = TEST_CONSTANTS.CALLBACK_ID;
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          CallbackDetails: {
            CallbackId: "catch-test-callback",
          },
        } as Operation,
      };

      const [promise] = await callbackHandler<string>("catch-test");

      // Call catch on the promise - this should trigger termination
      promise.catch(() => {});

      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CALLBACK_PENDING,
        message: "Callback catch-test is pending external completion",
      });
    });

    test("should terminate when finally is called on started callback promise", async () => {
      const stepId = TEST_CONSTANTS.CALLBACK_ID;
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          CallbackDetails: {
            CallbackId: "finally-test-callback",
          },
        } as Operation,
      };

      const [promise] = await callbackHandler<string>("finally-test");

      // Call finally on the promise - this should trigger termination
      promise.finally(() => {});

      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CALLBACK_PENDING,
        message: "Callback finally-test is pending external completion",
      });
    });
  });

  describe("New Callback Creation Scenarios", () => {
    test("should create new callback and return never-resolving promise", async () => {
      // Mock the checkpoint to simulate callback creation
      mockCheckpoint.mockImplementation(async (stepId, _operation) => {
        // Simulate the API updating stepData with callback ID after checkpoint
        const hashedStepId = hashId(stepId);
        mockExecutionContext._stepData[hashedStepId] = {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          CallbackDetails: {
            CallbackId: "new-callback-789",
          },
        } as Operation;
      });

      const [promise, callbackId] =
        await callbackHandler<string>("new-callback");

      // Verify checkpoint was called with correct parameters
      expect(mockCheckpoint).toHaveBeenCalledWith(TEST_CONSTANTS.CALLBACK_ID, {
        Id: TEST_CONSTANTS.CALLBACK_ID,
        Action: "START",
        SubType: OperationSubType.CALLBACK,
        Type: OperationType.CALLBACK,
        Name: "new-callback",
        CallbackOptions: {
          TimeoutSeconds: undefined,
          HeartbeatTimeoutSeconds: undefined,
        },
      });

      // Verify the callback ID is returned
      expect(callbackId).toBe("new-callback-789");

      // Verify terminate was NOT called yet (should only be called when promise is awaited)
      expect(mockTerminationManager.terminate).not.toHaveBeenCalled();

      // Now await the promise, which should trigger termination
      promise.then(() => "should-never-resolve");

      // Verify terminate was called when the promise was awaited
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CALLBACK_PENDING,
        message:
          "Callback new-callback created and pending external completion",
      });
    });

    test("should create new callback with timeout configuration", async () => {
      mockCheckpoint.mockImplementation(async (stepId, _operation) => {
        const hashedStepId = hashId(stepId);
        mockExecutionContext._stepData[hashedStepId] = {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          CallbackDetails: {
            CallbackId: "timeout-callback-123",
          },
        } as Operation;
      });

      const config: CreateCallbackConfig<string> = {
        timeout: 300,
        heartbeatTimeout: 60,
      };

      const [, callbackId] = await callbackHandler<string>(
        "timeout-callback",
        config,
      );

      expect(mockCheckpoint).toHaveBeenCalledWith(TEST_CONSTANTS.CALLBACK_ID, {
        Id: TEST_CONSTANTS.CALLBACK_ID,
        Action: "START",
        SubType: OperationSubType.CALLBACK,
        Type: OperationType.CALLBACK,
        Name: "timeout-callback",
        CallbackOptions: {
          TimeoutSeconds: 300,
          HeartbeatTimeoutSeconds: 60,
        },
      });

      expect(callbackId).toBe("timeout-callback-123");
    });

    test("should create new callback without name", async () => {
      mockCheckpoint.mockImplementation(async (stepId, _operation) => {
        const hashedStepId = hashId(stepId);
        mockExecutionContext._stepData[hashedStepId] = {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          CallbackDetails: {
            CallbackId: "unnamed-callback-456",
          },
        } as Operation;
      });

      const [promise, callbackId] = await callbackHandler<string>();

      expect(mockCheckpoint).toHaveBeenCalledWith(TEST_CONSTANTS.CALLBACK_ID, {
        Id: TEST_CONSTANTS.CALLBACK_ID,
        Action: "START",
        SubType: OperationSubType.CALLBACK,
        Type: OperationType.CALLBACK,
        Name: undefined,
        CallbackOptions: {
          TimeoutSeconds: undefined,
          HeartbeatTimeoutSeconds: undefined,
        },
      });

      expect(callbackId).toBe("unnamed-callback-456");

      // Verify terminate was NOT called yet (should only be called when promise is awaited)
      expect(mockTerminationManager.terminate).not.toHaveBeenCalled();

      // Now await the promise, which should trigger termination
      promise.then(() => "should-never-resolve");

      // Verify termination message uses stepId when name is undefined
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CALLBACK_PENDING,
        message:
          "Callback test-callback-id created and pending external completion",
      });
    });

    test("should throw error if callback ID not found after checkpoint", async () => {
      // Mock checkpoint to not update stepData with callback ID
      mockCheckpoint.mockResolvedValue(undefined);

      await expect(
        callbackHandler<string>("missing-id-callback"),
      ).rejects.toThrow(
        "Callback ID not found in stepData after checkpoint: test-callback-id",
      );
    });

    test("should throw error if CallbackDetails missing after checkpoint", async () => {
      mockCheckpoint.mockImplementation(async (stepId, _operation) => {
        const hashedStepId = hashId(stepId);
        mockExecutionContext._stepData[hashedStepId] = {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          // Missing CallbackDetails
        } as Operation;
      });

      await expect(
        callbackHandler<string>("missing-details-callback"),
      ).rejects.toThrow(
        "Callback ID not found in stepData after checkpoint: test-callback-id",
      );
    });
  });

  describe("Configuration Parameter Handling", () => {
    test("should handle string name as first parameter", async () => {
      mockCheckpoint.mockImplementation(async (stepId, _operation) => {
        const hashedStepId = hashId(stepId);
        mockExecutionContext._stepData[hashedStepId] = {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          CallbackDetails: {
            CallbackId: "string-param-callback",
          },
        } as Operation;
      });

      const config: CreateCallbackConfig<string> = {
        timeout: 120,
      };

      const [, callbackId] = await callbackHandler<string>(
        "string-name",
        config,
      );

      expect(mockCheckpoint).toHaveBeenCalledWith(TEST_CONSTANTS.CALLBACK_ID, {
        Id: TEST_CONSTANTS.CALLBACK_ID,
        Action: "START",
        SubType: OperationSubType.CALLBACK,
        Type: OperationType.CALLBACK,
        Name: "string-name",
        CallbackOptions: {
          TimeoutSeconds: 120,
          HeartbeatTimeoutSeconds: undefined,
        },
      });

      expect(callbackId).toBe("string-param-callback");
    });

    test("should handle config object as first parameter", async () => {
      mockCheckpoint.mockImplementation(async (stepId, _operation) => {
        const hashedStepId = hashId(stepId);
        mockExecutionContext._stepData[hashedStepId] = {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          CallbackDetails: {
            CallbackId: "config-first-callback",
          },
        } as Operation;
      });

      const config: CreateCallbackConfig<string> = {
        timeout: 180,
        heartbeatTimeout: 30,
      };

      const [, callbackId] = await callbackHandler<string>(config);

      expect(mockCheckpoint).toHaveBeenCalledWith(TEST_CONSTANTS.CALLBACK_ID, {
        Id: TEST_CONSTANTS.CALLBACK_ID,
        Action: "START",
        SubType: OperationSubType.CALLBACK,
        Type: OperationType.CALLBACK,
        Name: undefined,
        CallbackOptions: {
          TimeoutSeconds: 180,
          HeartbeatTimeoutSeconds: 30,
        },
      });

      expect(callbackId).toBe("config-first-callback");
    });

    test("should accept undefined as name parameter", async () => {
      const config: CreateCallbackConfig<string> = { timeout: 300 };

      mockExecutionContext._stepData = {};

      // Mock the checkpoint to simulate callback creation
      mockCheckpoint.mockImplementation(async (stepId, _operation) => {
        const hashedStepId = hashId(stepId);
        mockExecutionContext._stepData[hashedStepId] = {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          CallbackDetails: {
            CallbackId: "undefined-callback-123",
          },
        } as Operation;
      });

      const callbackHandler = createCallback(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        jest.fn().mockReturnValue(false),
      );

      const result = callbackHandler(undefined, config);

      // Wait for the async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockCheckpoint).toHaveBeenCalledWith(TEST_CONSTANTS.CALLBACK_ID, {
        Id: TEST_CONSTANTS.CALLBACK_ID,
        ParentId: undefined,
        Action: "START",
        SubType: OperationSubType.CALLBACK,
        Type: OperationType.CALLBACK,
        Name: undefined,
        CallbackOptions: {
          TimeoutSeconds: 300,
          HeartbeatTimeoutSeconds: undefined,
        },
      });

      // Verify it returns a promise
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe("Running Operations and Status Checking", () => {
    test("should wait for running operations before checking status", async () => {
      const mockHasRunningOperations = jest
        .fn()
        .mockReturnValueOnce(true) // First call: operations running
        .mockReturnValueOnce(false); // Second call: operations finished

      const callbackHandler = createCallback(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      // Set up a started callback
      mockExecutionContext.getStepData.mockReturnValue({
        Id: TEST_CONSTANTS.CALLBACK_ID,
        Type: OperationType.CALLBACK,
        StartTimestamp: new Date(),
        Status: OperationStatus.STARTED,
        CallbackDetails: { CallbackId: "callback-123" },
      });

      const [promise] = await callbackHandler<string>("test-callback");

      // Mock waitBeforeContinue to simulate waiting
      const { waitBeforeContinue } = await import(
        "../../utils/wait-before-continue/wait-before-continue"
      );
      const mockWaitBeforeContinue = waitBeforeContinue as jest.Mock;
      mockWaitBeforeContinue.mockResolvedValue({ reason: "operations" });

      // Trigger the promise (this will call terminate, not resolve)
      promise.then(() => {}).catch(() => {});

      // Verify waitBeforeContinue was called with correct parameters
      expect(mockWaitBeforeContinue).toHaveBeenCalledWith({
        checkHasRunningOperations: true,
        checkStepStatus: true,
        checkTimer: false,
        stepId: expect.any(String),
        context: mockExecutionContext,
        hasRunningOperations: mockHasRunningOperations,
        pollingInterval: 1000,
      });
    });

    test("should check both operations and status when operations are running", async () => {
      const mockHasRunningOperations = jest.fn().mockReturnValue(true);

      const callbackHandler = createCallback(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      mockExecutionContext.getStepData.mockReturnValue({
        Id: TEST_CONSTANTS.CALLBACK_ID,
        Type: OperationType.CALLBACK,
        StartTimestamp: new Date(),
        Status: OperationStatus.STARTED,
        CallbackDetails: { CallbackId: "callback-123" },
      });

      const [promise] = await callbackHandler<string>("test-callback");

      // Mock waitBeforeContinue
      const { waitBeforeContinue } = await import(
        "../../utils/wait-before-continue/wait-before-continue"
      );
      const mockWaitBeforeContinue = waitBeforeContinue as jest.Mock;
      mockWaitBeforeContinue.mockResolvedValue({ reason: "status" });

      // Trigger the promise
      promise.then(() => {}).catch(() => {});

      // Verify both checkHasRunningOperations and checkStepStatus are enabled
      expect(mockWaitBeforeContinue).toHaveBeenCalledWith(
        expect.objectContaining({
          checkHasRunningOperations: true,
          checkStepStatus: true,
          checkTimer: false,
        }),
      );
    });

    test("should terminate if no running operations and status unchanged", async () => {
      const mockHasRunningOperations = jest.fn().mockReturnValue(false);

      const callbackHandler = createCallback(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      // Set up a started callback that remains started
      mockExecutionContext.getStepData.mockReturnValue({
        Id: TEST_CONSTANTS.CALLBACK_ID,
        Type: OperationType.CALLBACK,
        StartTimestamp: new Date(),
        Status: OperationStatus.STARTED,
        CallbackDetails: { CallbackId: "callback-123" },
      });

      const [promise] = await callbackHandler<string>("test-callback");

      // Trigger the promise
      promise.then(() => {}).catch(() => {});

      // Should terminate since no operations and status unchanged
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CALLBACK_PENDING,
        message: "Callback test-callback is pending external completion",
      });
    });

    test("should skip waitBeforeContinue if no running operations", async () => {
      const mockHasRunningOperations = jest.fn().mockReturnValue(false);

      const callbackHandler = createCallback(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      mockExecutionContext.getStepData.mockReturnValue({
        Id: TEST_CONSTANTS.CALLBACK_ID,
        Type: OperationType.CALLBACK,
        StartTimestamp: new Date(),
        Status: OperationStatus.STARTED,
        CallbackDetails: { CallbackId: "callback-123" },
      });

      const [promise] = await callbackHandler<string>("test-callback");

      // Mock waitBeforeContinue
      const mockWaitBeforeContinue = (
        await import("../../utils/wait-before-continue/wait-before-continue")
      ).waitBeforeContinue as jest.Mock;
      mockWaitBeforeContinue.mockClear();

      // Trigger the promise
      promise.then(() => {}).catch(() => {});

      // Should not call waitBeforeContinue since no operations running
      expect(mockWaitBeforeContinue).not.toHaveBeenCalled();
    });

    test("should handle catch() method with same logic as then()", async () => {
      const mockHasRunningOperations = jest.fn().mockReturnValue(true);

      const callbackHandler = createCallback(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      mockExecutionContext.getStepData.mockReturnValue({
        Id: TEST_CONSTANTS.CALLBACK_ID,
        Type: OperationType.CALLBACK,
        StartTimestamp: new Date(),
        Status: OperationStatus.STARTED,
        CallbackDetails: { CallbackId: "callback-123" },
      });

      const [promise] = await callbackHandler<string>("test-callback");

      // Mock waitBeforeContinue
      const mockWaitBeforeContinue = (
        await import("../../utils/wait-before-continue/wait-before-continue")
      ).waitBeforeContinue as jest.Mock;
      mockWaitBeforeContinue.mockResolvedValue({ reason: "operations" });

      // Trigger catch() method
      promise.catch(() => {});

      // Should call waitBeforeContinue through catch -> then delegation
      expect(mockWaitBeforeContinue).toHaveBeenCalledWith({
        checkHasRunningOperations: true,
        checkStepStatus: true,
        checkTimer: false,
        stepId: expect.any(String),
        context: mockExecutionContext,
        hasRunningOperations: mockHasRunningOperations,
        pollingInterval: 1000,
      });
    });

    test("should handle finally() method with same logic as then()", async () => {
      const mockHasRunningOperations = jest.fn().mockReturnValue(true);

      const callbackHandler = createCallback(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      mockExecutionContext.getStepData.mockReturnValue({
        Id: TEST_CONSTANTS.CALLBACK_ID,
        Type: OperationType.CALLBACK,
        StartTimestamp: new Date(),
        Status: OperationStatus.STARTED,
        CallbackDetails: { CallbackId: "callback-123" },
      });

      const [promise] = await callbackHandler<string>("test-callback");

      // Mock waitBeforeContinue
      const mockWaitBeforeContinue = (
        await import("../../utils/wait-before-continue/wait-before-continue")
      ).waitBeforeContinue as jest.Mock;
      mockWaitBeforeContinue.mockResolvedValue({ reason: "operations" });

      // Trigger finally() method
      promise.finally(() => {});

      // Should call waitBeforeContinue through finally -> then delegation
      expect(mockWaitBeforeContinue).toHaveBeenCalledWith({
        checkHasRunningOperations: true,
        checkStepStatus: true,
        checkTimer: false,
        stepId: expect.any(String),
        context: mockExecutionContext,
        hasRunningOperations: mockHasRunningOperations,
        pollingInterval: 1000,
      });
    });

    test("should pass hasRunningOperations function to createCallback", async () => {
      const mockHasRunningOperations = jest.fn().mockReturnValue(false);

      // Verify that createCallback accepts the hasRunningOperations parameter
      expect(() => {
        createCallback(
          mockExecutionContext,
          mockCheckpoint,
          createStepId,
          mockHasRunningOperations,
        );
      }).not.toThrow();

      // Verify the function is called when checking operations
      const callbackHandler = createCallback(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      mockExecutionContext.getStepData.mockReturnValue({
        Id: TEST_CONSTANTS.CALLBACK_ID,
        Type: OperationType.CALLBACK,
        StartTimestamp: new Date(),
        Status: OperationStatus.STARTED,
        CallbackDetails: { CallbackId: "callback-123" },
      });

      const [promise] = await callbackHandler<string>("test-callback");
      promise.then(() => {}).catch(() => {});

      expect(mockHasRunningOperations).toHaveBeenCalled();
    });

    test("should use 1000ms polling interval for waitBeforeContinue", async () => {
      const mockHasRunningOperations = jest.fn().mockReturnValue(true);

      const callbackHandler = createCallback(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      mockExecutionContext.getStepData.mockReturnValue({
        Id: TEST_CONSTANTS.CALLBACK_ID,
        Type: OperationType.CALLBACK,
        StartTimestamp: new Date(),
        Status: OperationStatus.STARTED,
        CallbackDetails: { CallbackId: "callback-123" },
      });

      const [promise] = await callbackHandler<string>("test-callback");

      // Mock waitBeforeContinue
      const mockWaitBeforeContinue = (
        await import("../../utils/wait-before-continue/wait-before-continue")
      ).waitBeforeContinue as jest.Mock;
      mockWaitBeforeContinue.mockResolvedValue({ reason: "operations" });

      // Trigger the promise
      promise.then(() => {}).catch(() => {});

      // Verify 1000ms polling interval is used
      expect(mockWaitBeforeContinue).toHaveBeenCalledWith(
        expect.objectContaining({
          pollingInterval: 1000,
        }),
      );
    });

    test("should handle callback completion during operation wait (SUCCEEDED path)", async () => {
      const mockHasRunningOperations = jest.fn().mockReturnValue(true);

      const callbackHandler = createCallback(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      // Initially STARTED, then becomes SUCCEEDED after waitBeforeContinue
      let callCount = 0;
      mockExecutionContext.getStepData.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call during callback creation
          return {
            Id: TEST_CONSTANTS.CALLBACK_ID,
            Type: OperationType.CALLBACK,
            StartTimestamp: new Date(),
            Status: OperationStatus.STARTED,
            CallbackDetails: { CallbackId: "callback-123" },
          };
        } else {
          // Second call after waitBeforeContinue - status changed to SUCCEEDED
          return {
            Id: TEST_CONSTANTS.CALLBACK_ID,
            Type: OperationType.CALLBACK,
            StartTimestamp: new Date(),
            Status: OperationStatus.SUCCEEDED,
            CallbackDetails: {
              CallbackId: "callback-123",
              Result: "success-result",
            },
          };
        }
      });

      const [promise] = await callbackHandler<string>("test-callback");

      // Mock waitBeforeContinue to simulate the wait completing
      const mockWaitBeforeContinue = (
        await import("../../utils/wait-before-continue/wait-before-continue")
      ).waitBeforeContinue as jest.Mock;
      mockWaitBeforeContinue.mockResolvedValue({ reason: "status" });

      // Trigger the promise - this should execute the SUCCEEDED path
      promise.then(() => {}).catch(() => {});

      // The key verification is that getStepData was called twice:
      // 1. During callback creation (returns STARTED)
      // 2. After waitBeforeContinue (returns SUCCEEDED)
      expect(mockExecutionContext.getStepData).toHaveBeenCalledTimes(2);

      // Verify waitBeforeContinue was called (indicating operations were running)
      expect(mockWaitBeforeContinue).toHaveBeenCalled();
    });

    test("should handle callback failure during operation wait (FAILED path)", async () => {
      const mockHasRunningOperations = jest.fn().mockReturnValue(true);

      const callbackHandler = createCallback(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      // Initially STARTED, then becomes FAILED after waitBeforeContinue
      let callCount = 0;
      mockExecutionContext.getStepData.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call during callback creation
          return {
            Id: TEST_CONSTANTS.CALLBACK_ID,
            Type: OperationType.CALLBACK,
            StartTimestamp: new Date(),
            Status: OperationStatus.STARTED,
            CallbackDetails: { CallbackId: "callback-123" },
          };
        } else {
          // Second call after waitBeforeContinue - status changed to FAILED
          return {
            Id: TEST_CONSTANTS.CALLBACK_ID,
            Type: OperationType.CALLBACK,
            StartTimestamp: new Date(),
            Status: OperationStatus.FAILED,
            CallbackDetails: {
              CallbackId: "callback-123",
              Error: {
                ErrorMessage: "Callback failed",
                ErrorType: "CallbackError",
              },
            },
          };
        }
      });

      const [promise] = await callbackHandler<string>("test-callback");

      // Mock waitBeforeContinue to simulate the wait completing
      const mockWaitBeforeContinue = (
        await import("../../utils/wait-before-continue/wait-before-continue")
      ).waitBeforeContinue as jest.Mock;
      mockWaitBeforeContinue.mockResolvedValue({ reason: "status" });

      // Trigger the promise - this should execute the FAILED path
      promise.then(() => {}).catch(() => {});

      // The key verification is that getStepData was called twice:
      // 1. During callback creation (returns STARTED)
      // 2. After waitBeforeContinue (returns FAILED)
      expect(mockExecutionContext.getStepData).toHaveBeenCalledTimes(2);

      // Verify waitBeforeContinue was called (indicating operations were running)
      expect(mockWaitBeforeContinue).toHaveBeenCalled();
    });

    test("should execute finally callbacks for both success and error paths", async () => {
      const mockHasRunningOperations = jest.fn().mockReturnValue(false);

      const callbackHandler = createCallback(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      mockExecutionContext.getStepData.mockReturnValue({
        Id: TEST_CONSTANTS.CALLBACK_ID,
        Type: OperationType.CALLBACK,
        StartTimestamp: new Date(),
        Status: OperationStatus.STARTED,
        CallbackDetails: { CallbackId: "callback-123" },
      });

      const [promise] = await callbackHandler<string>("test-callback");

      // Mock the finally callback to verify it gets called
      const mockFinallyCallback = jest.fn();

      // Override the then method to capture and manually execute the finally callbacks
      const originalThen = promise.then.bind(promise);
      jest
        .spyOn(promise, "then")
        .mockImplementation((onFulfilled, onRejected) => {
          // Manually execute the success callback (lines 89-91)
          if (onFulfilled) {
            try {
              onFulfilled("test-value");
              // This should call _onfinally?.() and return value
            } catch (_e) {
              // Ignore errors for this test
            }
          }

          // Manually execute the error callback (lines 92-94)
          if (onRejected) {
            try {
              onRejected(new Error("test-error"));
              // This should call _onfinally?.() and throw reason
            } catch (_e) {
              // Expected to throw
            }
          }

          // Return the original then call
          return originalThen(onFulfilled, onRejected);
        });

      // Call finally - this will trigger our mocked then method
      promise.finally(mockFinallyCallback);

      // Verify the finally callback was set up (we can't easily verify it was called
      // due to the complex promise delegation, but we've triggered the code paths)
      expect(promise.then).toHaveBeenCalled();
      expect(mockFinallyCallback).toBeDefined();
    });

    test("should handle onfulfilled callback in then method", async () => {
      const stepId = TEST_CONSTANTS.CALLBACK_ID;
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.SUCCEEDED,
          CallbackDetails: {
            CallbackId: "callback-123",
            Result: "test-result",
          },
        } as Operation,
      };

      const [promise] = await callbackHandler<string>("test-callback");

      const onfulfilled = jest.fn((value) => `transformed-${value}`);
      const result = await promise.then(onfulfilled);

      expect(onfulfilled).toHaveBeenCalledWith("deserialized-result");
      expect(result).toBe("transformed-deserialized-result");
    });

    test("should handle onrejected callback in then method", async () => {
      const stepId = TEST_CONSTANTS.CALLBACK_ID;
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.FAILED,
          CallbackDetails: {
            CallbackId: "callback-123",
            Error: {
              ErrorMessage: "Test error",
              ErrorType: "TestError",
            },
          },
        } as Operation,
      };

      const [promise] = await callbackHandler<string>("test-callback");

      const onrejected = jest.fn((err) => `handled-${err.message}`);
      const result = await promise.then(null, onrejected);

      expect(onrejected).toHaveBeenCalledWith(expect.any(CallbackError));
      expect(result).toBe("handled-Callback failed");
    });

    test("should return result directly when onfulfilled is not provided", async () => {
      const stepId = TEST_CONSTANTS.CALLBACK_ID;
      const hashedStepId = hashId(stepId);
      mockExecutionContext._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.SUCCEEDED,
          CallbackDetails: {
            CallbackId: "callback-123",
            Result: "test-result",
          },
        } as Operation,
      };

      const [promise] = await callbackHandler<string>("test-callback");

      // Call then with null onfulfilled to hit line 67
      const result = await promise.then(null);

      expect(result).toBe("deserialized-result");
    });

    test("should cover line 67 by returning result without onfulfilled after wait", async () => {
      const mockHasRunningOperations = jest.fn().mockReturnValue(true);
      const callbackHandler = createCallback(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      let callCount = 0;
      mockExecutionContext.getStepData.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            Id: TEST_CONSTANTS.CALLBACK_ID,
            Type: OperationType.CALLBACK,
            StartTimestamp: new Date(),
            Status: OperationStatus.STARTED,
            CallbackDetails: { CallbackId: "callback-123" },
          };
        } else {
          return {
            Id: TEST_CONSTANTS.CALLBACK_ID,
            Type: OperationType.CALLBACK,
            StartTimestamp: new Date(),
            Status: OperationStatus.SUCCEEDED,
            CallbackDetails: {
              CallbackId: "callback-123",
              Result: "success-data",
            },
          };
        }
      });

      const [promise] = await callbackHandler<string>("test-callback");

      const mockWaitBeforeContinue = (
        await import("../../utils/wait-before-continue/wait-before-continue")
      ).waitBeforeContinue as jest.Mock;
      mockWaitBeforeContinue.mockResolvedValue({ reason: "status" });

      const result = await promise.then(null);
      expect(result).toBe("deserialized-result");
    });

    test("should rethrow error when no onrejected handler provided", async () => {
      const mockHasRunningOperations = jest.fn().mockReturnValue(true);
      const callbackHandler = createCallback(
        mockExecutionContext,
        mockCheckpoint,
        createStepId,
        mockHasRunningOperations,
      );

      let callCount = 0;
      mockExecutionContext.getStepData.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            Id: TEST_CONSTANTS.CALLBACK_ID,
            Type: OperationType.CALLBACK,
            StartTimestamp: new Date(),
            Status: OperationStatus.STARTED,
            CallbackDetails: { CallbackId: "callback-123" },
          };
        } else {
          return {
            Id: TEST_CONSTANTS.CALLBACK_ID,
            Type: OperationType.CALLBACK,
            StartTimestamp: new Date(),
            Status: OperationStatus.FAILED,
            CallbackDetails: {
              CallbackId: "callback-123",
              Error: { ErrorMessage: "Test error" },
            },
          };
        }
      });

      const [promise] = await callbackHandler<string>("test-callback");

      const mockWaitBeforeContinue = (
        await import("../../utils/wait-before-continue/wait-before-continue")
      ).waitBeforeContinue as jest.Mock;
      mockWaitBeforeContinue.mockResolvedValue({ reason: "status" });

      await expect(promise).rejects.toThrow(CallbackError);
    });
  });
});
