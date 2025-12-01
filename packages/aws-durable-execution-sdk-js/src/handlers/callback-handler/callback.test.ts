import { createCallback, createPassThroughSerdes } from "./callback";
import {
  ExecutionContext,
  CreateCallbackConfig,
  OperationSubType,
} from "../../types";
import {
  OperationStatus,
  OperationType,
  Operation,
} from "@aws-sdk/client-lambda";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import { safeDeserialize } from "../../errors/serdes-errors/serdes-errors";
import { CallbackError } from "../../errors/durable-error/durable-error";

jest.mock("../../utils/logger/logger");
jest.mock("../../errors/serdes-errors/serdes-errors");

const mockSafeDeserialize = safeDeserialize as jest.MockedFunction<
  typeof safeDeserialize
>;

describe("Callback Handler", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let createStepId: jest.Mock;
  let checkAndUpdateReplayMode: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockContext = {
      getStepData: jest.fn(),
      _stepData: {},
      terminationManager: {
        terminate: jest.fn(),
      },
      durableExecutionArn: "test-arn",
    } as any;

    mockCheckpoint = {
      checkpoint: jest.fn().mockResolvedValue(undefined),
      markOperationState: jest.fn(),
      markOperationAwaited: jest.fn(),
      waitForStatusChange: jest.fn().mockResolvedValue(undefined),
    } as any;

    createStepId = jest.fn().mockReturnValue("test-callback-id");
    checkAndUpdateReplayMode = jest.fn();

    mockSafeDeserialize.mockResolvedValue("deserialized-result");
  });

  describe("Completed Callback Scenarios", () => {
    it("should return cached result for already completed callback", async () => {
      const stepId = "test-callback-id";
      const hashedStepId = hashId(stepId);
      (mockContext as any)._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.SUCCEEDED,
          CallbackDetails: {
            CallbackId: "callback-123",
            Result: "completed-result",
          },
        } as Operation,
      };

      (mockContext.getStepData as jest.Mock).mockReturnValue(
        (mockContext as any)._stepData[hashedStepId],
      );

      const handler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        checkAndUpdateReplayMode,
      );

      const result = await handler<string>("test-callback");
      const [promise, callbackId] = await result;

      expect(callbackId).toBe("callback-123");
      expect(await promise).toBe("deserialized-result");
      expect(mockSafeDeserialize).toHaveBeenCalledWith(
        expect.any(Object),
        "completed-result",
        stepId,
        "test-callback",
        mockContext.terminationManager,
        "test-arn",
      );
      expect(mockCheckpoint.checkpoint).not.toHaveBeenCalled();
      expect(checkAndUpdateReplayMode).toHaveBeenCalled();
    });

    it("should handle completed callback with undefined result", async () => {
      const stepId = "test-callback-id";
      const hashedStepId = hashId(stepId);
      (mockContext as any)._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.SUCCEEDED,
          CallbackDetails: {
            CallbackId: "callback-123",
          },
        } as Operation,
      };

      (mockContext.getStepData as jest.Mock).mockReturnValue(
        (mockContext as any)._stepData[hashedStepId],
      );

      const handler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        checkAndUpdateReplayMode,
      );

      const result = await handler<string>("test-callback");
      const [promise, callbackId] = await result;

      expect(callbackId).toBe("callback-123");
      expect(await promise).toBe("deserialized-result");
      expect(mockSafeDeserialize).toHaveBeenCalledWith(
        expect.any(Object),
        undefined,
        stepId,
        "test-callback",
        mockContext.terminationManager,
        "test-arn",
      );
    });

    it("should handle completed callback without name", async () => {
      const stepId = "test-callback-id";
      const hashedStepId = hashId(stepId);
      (mockContext as any)._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.SUCCEEDED,
          CallbackDetails: {
            CallbackId: "callback-456",
            Result: "result-data",
          },
        } as Operation,
      };

      (mockContext.getStepData as jest.Mock).mockReturnValue(
        (mockContext as any)._stepData[hashedStepId],
      );

      const handler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        checkAndUpdateReplayMode,
      );

      const result = await handler<string>();
      const [promise, callbackId] = await result;

      expect(callbackId).toBe("callback-456");
      expect(await promise).toBe("deserialized-result");
      expect(mockSafeDeserialize).toHaveBeenCalledWith(
        expect.any(Object),
        "result-data",
        stepId,
        undefined,
        mockContext.terminationManager,
        "test-arn",
      );
    });

    it("should use pass-through serdes that preserves data unchanged", async () => {
      const serdes = createPassThroughSerdes<string>();
      const testData = "test data";

      const mockSerdesContext = {} as any;

      const serialized = await serdes.serialize(testData, mockSerdesContext);
      const deserialized = await serdes.deserialize(
        serialized,
        mockSerdesContext,
      );

      expect(serialized).toBe(testData);
      expect(deserialized).toBe(testData);
    });

    it("should throw error if completed callback has no callback ID", async () => {
      const stepId = "test-callback-id";
      const hashedStepId = hashId(stepId);
      (mockContext as any)._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.SUCCEEDED,
          CallbackDetails: {
            Result: "some-result",
          },
        } as Operation,
      };

      (mockContext.getStepData as jest.Mock).mockReturnValue(
        (mockContext as any)._stepData[hashedStepId],
      );

      const handler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        checkAndUpdateReplayMode,
      );

      await expect(handler<string>("test-callback")).rejects.toThrow(
        CallbackError,
      );
      await expect(handler<string>("test-callback")).rejects.toThrow(
        "No callback ID found for callback: test-callback-id",
      );
    });

    it("should use custom serdes for completed callback", async () => {
      const customSerdes = {
        serialize: jest.fn(),
        deserialize: jest.fn(),
      };

      const stepId = "test-callback-id";
      const hashedStepId = hashId(stepId);
      (mockContext as any)._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.SUCCEEDED,
          CallbackDetails: {
            CallbackId: "callback-custom",
            Result: "custom-result",
          },
        } as Operation,
      };

      (mockContext.getStepData as jest.Mock).mockReturnValue(
        (mockContext as any)._stepData[hashedStepId],
      );

      const config: CreateCallbackConfig<string> = {
        serdes: customSerdes,
        timeout: { minutes: 5 },
      };

      const handler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        checkAndUpdateReplayMode,
      );

      const result = await handler<string>("custom-callback", config);
      const [promise, callbackId] = await result;

      expect(callbackId).toBe("callback-custom");
      await promise;

      expect(mockSafeDeserialize).toHaveBeenCalledWith(
        customSerdes,
        "custom-result",
        stepId,
        "custom-callback",
        mockContext.terminationManager,
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
    it(`should throw error for ${statusName} callback`, async () => {
      const stepId = "test-callback-id";
      const hashedStepId = hashId(stepId);
      (mockContext as any)._stepData = {
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

      (mockContext.getStepData as jest.Mock).mockReturnValue(
        (mockContext as any)._stepData[hashedStepId],
      );

      const handler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        checkAndUpdateReplayMode,
      );

      const result = await handler<string>(`${statusName}-callback`);
      const [promise, callbackId] = await result;

      expect(callbackId).toBe(testData.callbackId);

      await expect(promise).rejects.toThrow(CallbackError);

      try {
        await promise;
      } catch (err) {
        expect(err).toBeInstanceOf(CallbackError);
        expect((err as CallbackError).message).toEqual(testData.errorMessage);
        expect((err as CallbackError).errorData).toEqual(testData.errorData);

        const cause = (err as CallbackError).cause;
        expect(cause).toBeInstanceOf(Error);
        expect(cause!.message).toEqual(testData.errorMessage);
        expect(cause!.name).toEqual(testData.errorType);
        expect(cause!.stack).toEqual(testData.stackTrace.join("\n"));
      }
    });

    it(`should throw generic error for ${statusName} callback without error message`, async () => {
      const stepId = "test-callback-id";
      const hashedStepId = hashId(stepId);
      (mockContext as any)._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: status,
          CallbackDetails: {
            CallbackId: testData.callbackIdWithoutError,
          },
        } as Operation,
      };

      (mockContext.getStepData as jest.Mock).mockReturnValue(
        (mockContext as any)._stepData[hashedStepId],
      );

      const handler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        checkAndUpdateReplayMode,
      );

      const result = await handler<string>(`${statusName}-callback`);
      const [promise] = await result;

      await expect(promise).rejects.toThrow("Callback failed");
    });

    it(`should throw error for ${statusName} callback without CallbackId`, async () => {
      const stepId = "test-callback-id";
      const hashedStepId = hashId(stepId);
      (mockContext as any)._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: status,
          CallbackDetails: {},
        } as Operation,
      };

      (mockContext.getStepData as jest.Mock).mockReturnValue(
        (mockContext as any)._stepData[hashedStepId],
      );

      const handler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        checkAndUpdateReplayMode,
      );

      await expect(handler<string>(`${statusName}-callback`)).rejects.toThrow(
        `No callback ID found for callback: ${stepId}`,
      );
    });
  });

  describe("Started Callback Scenarios", () => {
    it("should return callback promise for started callback", async () => {
      const stepId = "test-callback-id";
      const hashedStepId = hashId(stepId);
      (mockContext as any)._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          CallbackDetails: {
            CallbackId: "started-callback-123",
          },
        } as Operation,
      };

      (mockContext.getStepData as jest.Mock).mockReturnValue(
        (mockContext as any)._stepData[hashedStepId],
      );

      const handler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        checkAndUpdateReplayMode,
      );

      const result = await handler<string>("started-callback");
      const [promise, callbackId] = await result;

      expect(callbackId).toBe("started-callback-123");
      expect(mockCheckpoint.markOperationState).toHaveBeenCalled();

      // Don't await the promise - it will wait for status change
      expect(promise).toBeDefined();
    });

    it("should throw error if started callback has no callback ID", async () => {
      const stepId = "test-callback-id";
      const hashedStepId = hashId(stepId);
      (mockContext as any)._stepData = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          CallbackDetails: {},
        } as Operation,
      };

      (mockContext.getStepData as jest.Mock).mockReturnValue(
        (mockContext as any)._stepData[hashedStepId],
      );

      const handler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        checkAndUpdateReplayMode,
      );

      await expect(handler<string>("started-callback")).rejects.toThrow(
        CallbackError,
      );
      await expect(handler<string>("started-callback")).rejects.toThrow(
        "No callback ID found for started callback: test-callback-id",
      );
    });
  });

  describe("New Callback Creation Scenarios", () => {
    it("should create new callback and return callback promise", async () => {
      (mockContext.getStepData as jest.Mock).mockReturnValueOnce(null);

      (mockCheckpoint.checkpoint as jest.Mock).mockImplementation(
        async (stepId) => {
          const hashedStepId = hashId(stepId);
          (mockContext as any)._stepData[hashedStepId] = {
            Id: hashedStepId,
            Status: OperationStatus.STARTED,
            CallbackDetails: {
              CallbackId: "new-callback-789",
            },
          } as Operation;
        },
      );

      (mockContext.getStepData as jest.Mock).mockImplementation((stepId) => {
        const hashedStepId = hashId(stepId);
        return (mockContext as any)._stepData[hashedStepId];
      });

      const handler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        checkAndUpdateReplayMode,
      );

      const result = await handler<string>("new-callback");
      const [_promise, callbackId] = await result;

      expect(mockCheckpoint.checkpoint).toHaveBeenCalledWith(
        "test-callback-id",
        {
          Id: "test-callback-id",
          ParentId: undefined,
          Action: "START",
          SubType: OperationSubType.CALLBACK,
          Type: OperationType.CALLBACK,
          Name: "new-callback",
          CallbackOptions: {
            TimeoutSeconds: undefined,
            HeartbeatTimeoutSeconds: undefined,
          },
        },
      );

      expect(callbackId).toBe("new-callback-789");
    });

    it("should create new callback with timeout configuration", async () => {
      (mockContext.getStepData as jest.Mock).mockReturnValueOnce(null);

      (mockCheckpoint.checkpoint as jest.Mock).mockImplementation(
        async (stepId) => {
          const hashedStepId = hashId(stepId);
          (mockContext as any)._stepData[hashedStepId] = {
            Id: hashedStepId,
            Status: OperationStatus.STARTED,
            CallbackDetails: {
              CallbackId: "timeout-callback-123",
            },
          } as Operation;
        },
      );

      (mockContext.getStepData as jest.Mock).mockImplementation((stepId) => {
        const hashedStepId = hashId(stepId);
        return (mockContext as any)._stepData[hashedStepId];
      });

      const config: CreateCallbackConfig<string> = {
        timeout: { minutes: 5 },
        heartbeatTimeout: { seconds: 60 },
      };

      const handler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        checkAndUpdateReplayMode,
      );

      const result = await handler<string>("timeout-callback", config);
      const [, callbackId] = await result;

      expect(mockCheckpoint.checkpoint).toHaveBeenCalledWith(
        "test-callback-id",
        {
          Id: "test-callback-id",
          ParentId: undefined,
          Action: "START",
          SubType: OperationSubType.CALLBACK,
          Type: OperationType.CALLBACK,
          Name: "timeout-callback",
          CallbackOptions: {
            TimeoutSeconds: 300,
            HeartbeatTimeoutSeconds: 60,
          },
        },
      );

      expect(callbackId).toBe("timeout-callback-123");
    });

    it("should create new callback without name", async () => {
      (mockContext.getStepData as jest.Mock).mockReturnValueOnce(null);

      (mockCheckpoint.checkpoint as jest.Mock).mockImplementation(
        async (stepId) => {
          const hashedStepId = hashId(stepId);
          (mockContext as any)._stepData[hashedStepId] = {
            Id: hashedStepId,
            Status: OperationStatus.STARTED,
            CallbackDetails: {
              CallbackId: "unnamed-callback-456",
            },
          } as Operation;
        },
      );

      (mockContext.getStepData as jest.Mock).mockImplementation((stepId) => {
        const hashedStepId = hashId(stepId);
        return (mockContext as any)._stepData[hashedStepId];
      });

      const handler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        checkAndUpdateReplayMode,
      );

      const result = await handler<string>();
      const [, callbackId] = await result;

      expect(mockCheckpoint.checkpoint).toHaveBeenCalledWith(
        "test-callback-id",
        {
          Id: "test-callback-id",
          ParentId: undefined,
          Action: "START",
          SubType: OperationSubType.CALLBACK,
          Type: OperationType.CALLBACK,
          Name: undefined,
          CallbackOptions: {
            TimeoutSeconds: undefined,
            HeartbeatTimeoutSeconds: undefined,
          },
        },
      );

      expect(callbackId).toBe("unnamed-callback-456");
    });

    it("should create callback with parentId when provided", async () => {
      (mockContext.getStepData as jest.Mock).mockReturnValueOnce(null);

      (mockCheckpoint.checkpoint as jest.Mock).mockImplementation(
        async (stepId) => {
          const hashedStepId = hashId(stepId);
          (mockContext as any)._stepData[hashedStepId] = {
            Id: hashedStepId,
            Status: OperationStatus.STARTED,
            CallbackDetails: {
              CallbackId: "child-callback-123",
            },
          } as Operation;
        },
      );

      (mockContext.getStepData as jest.Mock).mockImplementation((stepId) => {
        const hashedStepId = hashId(stepId);
        return (mockContext as any)._stepData[hashedStepId];
      });

      const handler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        checkAndUpdateReplayMode,
        "parent-id",
      );

      const result = await handler<string>("child-callback");
      await result;

      expect(mockCheckpoint.checkpoint).toHaveBeenCalledWith(
        "test-callback-id",
        expect.objectContaining({
          ParentId: "parent-id",
        }),
      );
    });
  });

  describe("Configuration Parameter Handling", () => {
    it("should handle string name as first parameter", async () => {
      (mockContext.getStepData as jest.Mock).mockReturnValueOnce(null);

      (mockCheckpoint.checkpoint as jest.Mock).mockImplementation(
        async (stepId) => {
          const hashedStepId = hashId(stepId);
          (mockContext as any)._stepData[hashedStepId] = {
            Id: hashedStepId,
            Status: OperationStatus.STARTED,
            CallbackDetails: {
              CallbackId: "string-param-callback",
            },
          } as Operation;
        },
      );

      (mockContext.getStepData as jest.Mock).mockImplementation((stepId) => {
        const hashedStepId = hashId(stepId);
        return (mockContext as any)._stepData[hashedStepId];
      });

      const config: CreateCallbackConfig<string> = {
        timeout: { minutes: 2 },
      };

      const handler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        checkAndUpdateReplayMode,
      );

      const result = await handler<string>("string-name", config);
      await result;

      expect(mockCheckpoint.checkpoint).toHaveBeenCalledWith(
        "test-callback-id",
        expect.objectContaining({
          Name: "string-name",
          CallbackOptions: {
            TimeoutSeconds: 120,
            HeartbeatTimeoutSeconds: undefined,
          },
        }),
      );
    });

    it("should handle config object as first parameter", async () => {
      (mockContext.getStepData as jest.Mock).mockReturnValueOnce(null);

      (mockCheckpoint.checkpoint as jest.Mock).mockImplementation(
        async (stepId) => {
          const hashedStepId = hashId(stepId);
          (mockContext as any)._stepData[hashedStepId] = {
            Id: hashedStepId,
            Status: OperationStatus.STARTED,
            CallbackDetails: {
              CallbackId: "config-first-callback",
            },
          } as Operation;
        },
      );

      (mockContext.getStepData as jest.Mock).mockImplementation((stepId) => {
        const hashedStepId = hashId(stepId);
        return (mockContext as any)._stepData[hashedStepId];
      });

      const config: CreateCallbackConfig<string> = {
        timeout: { minutes: 3 },
        heartbeatTimeout: { seconds: 30 },
      };

      const handler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        checkAndUpdateReplayMode,
      );

      const result = await handler<string>(config);
      await result;

      expect(mockCheckpoint.checkpoint).toHaveBeenCalledWith(
        "test-callback-id",
        expect.objectContaining({
          Name: undefined,
          CallbackOptions: {
            TimeoutSeconds: 180,
            HeartbeatTimeoutSeconds: 30,
          },
        }),
      );
    });

    it("should accept undefined as name parameter", async () => {
      (mockContext.getStepData as jest.Mock).mockReturnValueOnce(null);

      (mockCheckpoint.checkpoint as jest.Mock).mockImplementation(
        async (stepId) => {
          const hashedStepId = hashId(stepId);
          (mockContext as any)._stepData[hashedStepId] = {
            Id: hashedStepId,
            Status: OperationStatus.STARTED,
            CallbackDetails: {
              CallbackId: "undefined-callback-123",
            },
          } as Operation;
        },
      );

      (mockContext.getStepData as jest.Mock).mockImplementation((stepId) => {
        const hashedStepId = hashId(stepId);
        return (mockContext as any)._stepData[hashedStepId];
      });

      const config: CreateCallbackConfig<string> = { timeout: { minutes: 5 } };

      const handler = createCallback(
        mockContext,
        mockCheckpoint,
        createStepId,
        checkAndUpdateReplayMode,
      );

      const result = await handler<string>(undefined, config);
      await result;

      expect(mockCheckpoint.checkpoint).toHaveBeenCalledWith(
        "test-callback-id",
        expect.objectContaining({
          Name: undefined,
          CallbackOptions: {
            TimeoutSeconds: 300,
            HeartbeatTimeoutSeconds: undefined,
          },
        }),
      );
    });
  });
});
