import { startCheckpointServer } from "../checkpoint-server";
import { Server } from "http";
import request from "supertest";
import { ExecutionManager } from "../storage/execution-manager";
import { CheckpointManager } from "../storage/checkpoint-manager";
import { API_PATHS } from "../constants";
import {
  OperationStatus,
  OperationType,
  CheckpointDurableExecutionRequest,
  Operation,
  SendDurableExecutionCallbackHeartbeatRequest,
  InvalidParameterValueException,
  OperationAction,
  EventType,
  Event,
} from "@aws-sdk/client-lambda";
import {
  encodeCheckpointToken,
  CheckpointTokenData,
} from "../utils/checkpoint-token";
import {
  createExecutionId,
  createInvocationId,
  ExecutionId,
  InvocationId,
} from "../utils/tagged-strings";
import { createCheckpointToken } from "../utils/tagged-strings";
import { convertDatesToTimestamps } from "../../utils";

// Mock the ExecutionManager
jest.mock("../storage/execution-manager", () => {
  const originalModule = jest.requireActual<
    typeof import("../storage/execution-manager")
  >("../storage/execution-manager");
  return {
    ...originalModule,
    ExecutionManager: jest.fn(() => ({
      startExecution: jest.fn(),
      startInvocation: jest.fn(),
      completeInvocation: jest.fn(),
      getCheckpointsByExecution: jest.fn(),
      getCheckpointsByToken: jest.fn(),
      getCheckpointsByCallbackId: jest.fn(),
      cleanup: jest.fn(),
    })),
  };
});

// Mock CheckpointManager
jest.mock("../storage/checkpoint-manager");

// Mock crypto
jest.mock("node:crypto", () => ({
  randomUUID: jest.fn().mockReturnValue("mock-execution-id"),
  // Add required functions for Express
  createHash: jest.fn().mockImplementation(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue("mocked-hash"),
  })),
}));

// Mock the default logger
jest.mock("../../logger", () => ({
  defaultLogger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

describe("checkpoint-server", () => {
  let server: Server;
  let mockExecutionManager: jest.Mocked<ExecutionManager>;
  const TEST_PORT = 9000;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Need to re-mock ExecutionManager since we're importing it before the mock is set up
    mockExecutionManager =
      new ExecutionManager() as jest.Mocked<ExecutionManager>;
    jest.mocked(ExecutionManager).mockReturnValue(mockExecutionManager);

    server = await startCheckpointServer(TEST_PORT);
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  describe("startCheckpointServer", () => {
    it("should start a server on the specified port", () => {
      expect(server).toBeDefined();
      expect(server.listening).toBe(true);
    });
  });

  describe("API_PATHS.START_DURABLE_EXECUTION", () => {
    it("should call executionManager.startExecution with the correct parameters", async () => {
      const payload = JSON.stringify({ testKey: "testValue" });

      mockExecutionManager.startExecution.mockReturnValueOnce({
        checkpointToken: createCheckpointToken("mockToken"),
        executionId: createExecutionId("mockExecutionId"),
        invocationId: createInvocationId("mockInvocationId"),
        operationEvents: [],
      });

      const response = await request(server)
        .post(API_PATHS.START_DURABLE_EXECUTION)
        .send({ payload });

      expect(response.status).toBe(200);
      expect(mockExecutionManager.startExecution).toHaveBeenCalledWith({
        payload,
        executionId: expect.any(String),
      });
      expect(response.body).toEqual({
        checkpointToken: "mockToken",
        executionId: "mockExecutionId",
        invocationId: "mockInvocationId",
        operationEvents: [],
      });
    });
  });

  describe(`${API_PATHS.START_INVOCATION}/:executionId`, () => {
    it("should call executionManager.startInvocation with the correct parameters", async () => {
      const executionId = "test-execution-id";

      mockExecutionManager.startInvocation.mockReturnValueOnce({
        checkpointToken: createCheckpointToken("mockToken"),
        executionId: createExecutionId(executionId),
        invocationId: createInvocationId("mockInvocationId"),
        operationEvents: [],
      });

      const response = await request(server).post(
        `${API_PATHS.START_INVOCATION}/${executionId}`,
      );

      expect(response.status).toBe(200);
      expect(mockExecutionManager.startInvocation).toHaveBeenCalledWith(
        expect.any(String),
      );
      expect(response.body).toEqual({
        checkpointToken: "mockToken",
        executionId,
        invocationId: "mockInvocationId",
        operationEvents: [],
      });
    });

    it("should serialize operationEvents with timestamp conversions", async () => {
      const executionId = "test-execution-id";
      const startTime = new Date("2021-01-01T00:00:00.000Z");
      const endTime = new Date("2021-01-01T00:01:00.000Z");
      const eventTime1 = new Date("2021-01-01T00:00:10.000Z");
      const eventTime2 = new Date("2021-01-01T00:00:50.000Z");

      // Mock response with Date objects (as returned by CheckpointManager)
      mockExecutionManager.startInvocation.mockReturnValueOnce({
        checkpointToken: createCheckpointToken("mockToken"),
        executionId: createExecutionId(executionId),
        invocationId: createInvocationId("mockInvocationId"),
        operationEvents: [
          {
            operation: {
              Id: "op-123",
              Name: "TestOperation",
              Type: OperationType.STEP,
              Status: OperationStatus.SUCCEEDED,
              StartTimestamp: startTime,
              EndTimestamp: endTime,
              StepDetails: {
                Attempt: 1,
                Result: "test-result",
              },
            },
            events: [
              {
                EventId: 1,
                EventTimestamp: eventTime1,
                EventType: "StepStarted",
                Id: "event-1",
                Name: "Start",
              },
              {
                EventId: 2,
                EventTimestamp: eventTime2,
                EventType: "StepSucceeded",
                Id: "event-2",
                Name: "Success",
              },
            ],
          },
        ],
      });

      const response = await request(server).post(
        `${API_PATHS.START_INVOCATION}/${executionId}`,
      );

      expect(response.status).toBe(200);

      // Verify the serialized response matches expected structure with timestamp conversions
      expect(response.body).toEqual({
        checkpointToken: "mockToken",
        executionId,
        invocationId: "mockInvocationId",
        operationEvents: [
          {
            operation: {
              Id: "op-123",
              Name: "TestOperation",
              Type: OperationType.STEP,
              Status: OperationStatus.SUCCEEDED,
              StartTimestamp: Math.floor(startTime.getTime() / 1000),
              EndTimestamp: Math.floor(endTime.getTime() / 1000),
              StepDetails: {
                Attempt: 1,
                Result: "test-result",
              },
            },
            events: [
              {
                EventId: 1,
                EventTimestamp: Math.floor(eventTime1.getTime() / 1000),
                EventType: "StepStarted",
                Id: "event-1",
                Name: "Start",
              },
              {
                EventId: 2,
                EventTimestamp: Math.floor(eventTime2.getTime() / 1000),
                EventType: "StepSucceeded",
                Id: "event-2",
                Name: "Success",
              },
            ],
          },
        ],
      });
    });
  });

  describe(`${API_PATHS.COMPLETE_INVOCATION}/:executionId`, () => {
    it("should complete invocation successfully without error", async () => {
      const executionId = "test-execution-id";
      const invocationId = createInvocationId("test-invocation-id");
      const startTimestamp = new Date("2021-01-01T00:00:00.000Z");
      const endTimestamp = new Date("2021-01-01T00:01:00.000Z");

      const mockEvent = {
        EventId: 1,
        EventTimestamp: endTimestamp,
        EventType: EventType.InvocationCompleted,
        Id: "event-1",
        Name: "InvocationCompletedDetails",
        InvocationCompletedDetails: {
          StartTimestamp: startTimestamp,
          EndTimestamp: endTimestamp,
          Error: {
            Payload: undefined,
          },
          RequestId: invocationId,
        },
      };

      mockExecutionManager.completeInvocation.mockReturnValueOnce(mockEvent);

      const response = await request(server)
        .post(`${API_PATHS.COMPLETE_INVOCATION}/${executionId}`)
        .send({
          invocationId,
          error: undefined,
        });

      expect(response.status).toBe(200);
      expect(mockExecutionManager.completeInvocation).toHaveBeenCalledWith(
        executionId,
        invocationId,
        undefined,
      );
      expect(response.body).toEqual({
        EventId: 1,
        EventTimestamp: Math.floor(endTimestamp.getTime() / 1000),
        EventType: "InvocationCompleted",
        Id: "event-1",
        Name: "InvocationCompletedDetails",
        InvocationCompletedDetails: {
          StartTimestamp: Math.floor(startTimestamp.getTime() / 1000),
          EndTimestamp: Math.floor(endTimestamp.getTime() / 1000),
          Error: {
            Payload: undefined,
          },
          RequestId: invocationId,
        },
      });
    });

    it("should handle complex error objects with nested properties", async () => {
      const executionId = "test-execution-id";
      const invocationId = createInvocationId("test-invocation-id");
      const startTimestamp = new Date("2021-01-01T00:00:00.000Z");
      const endTimestamp = new Date("2021-01-01T00:01:00.000Z");
      const complexError = {
        ErrorType: "ValidationException",
        ErrorMessage: "Invalid input parameters",
        StackTrace: ["Error: Invalid input\n", "    at Function.validate"],
      };

      const mockEvent: Event = {
        EventId: 3,
        EventTimestamp: endTimestamp,
        EventType: EventType.InvocationCompleted,
        Id: "event-3",
        Name: "InvocationCompletedDetails",
        InvocationCompletedDetails: {
          StartTimestamp: startTimestamp,
          EndTimestamp: endTimestamp,
          Error: {
            Payload: complexError,
          },
          RequestId: invocationId,
        },
      };

      mockExecutionManager.completeInvocation.mockReturnValueOnce(mockEvent);

      const response = await request(server)
        .post(`${API_PATHS.COMPLETE_INVOCATION}/${executionId}`)
        .send({
          invocationId,
          error: complexError,
        });

      expect(response.status).toBe(200);
      expect(mockExecutionManager.completeInvocation).toHaveBeenCalledWith(
        executionId,
        invocationId,
        complexError,
      );
      expect(response.body).toStrictEqual(convertDatesToTimestamps(mockEvent));
    });
  });

  describe(`${API_PATHS.POLL_CHECKPOINT_DATA}/:executionId`, () => {
    it("should return pending checkpoint updates when execution exists", async () => {
      const executionId = "test-execution-id";
      const mockStorage = new CheckpointManager(
        createExecutionId("test-execution-id"),
      );
      const startTimestamp = new Date("2021-01-01T00:00:00.000Z");

      jest
        .spyOn(mockStorage, "getPendingCheckpointUpdates")
        .mockResolvedValueOnce([
          {
            operation: {
              Id: "op1",
              Type: OperationType.STEP,
              StartTimestamp: startTimestamp,
              Status: "STARTED",
            },
            update: {
              Id: "op1",
              Type: OperationType.STEP,
              Action: "START",
            },
            events: [],
          },
        ]);

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        mockStorage,
      );

      const response = await request(server).get(
        `${API_PATHS.POLL_CHECKPOINT_DATA}/${executionId}`,
      );

      expect(response.status).toBe(200);
      expect(
        mockExecutionManager.getCheckpointsByExecution,
      ).toHaveBeenCalledWith(executionId);
      expect(mockStorage.getPendingCheckpointUpdates).toHaveBeenCalled();
      expect(response.body).toEqual({
        operations: [
          {
            events: [],
            operation: {
              Id: "op1",
              Type: OperationType.STEP,
              StartTimestamp: Math.floor(startTimestamp.getTime() / 1000),
              Status: "STARTED",
            },
            update: {
              Id: "op1",
              Type: OperationType.STEP,
              Action: "START",
            },
          },
        ],
      });
    });

    it("should return 500 when execution does not exist", async () => {
      const executionId = "non-existent-id";

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        undefined,
      );

      const response = await request(server).get(
        `${API_PATHS.POLL_CHECKPOINT_DATA}/${executionId}`,
      );

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: "Execution not found" });
    });
  });

  describe(`${API_PATHS.UPDATE_CHECKPOINT_DATA}/:executionId/:operationId`, () => {
    it("should update operation status and return the updated operation", async () => {
      const executionId = "test-execution-id";
      const operationId = "test-operation-id";
      const status = OperationStatus.SUCCEEDED;

      const mockUpdatedOperation = {
        Id: operationId,
        Status: OperationStatus.SUCCEEDED,
      };

      const mockStorage = {
        updateOperation: jest.fn().mockReturnValue(mockUpdatedOperation),
        hasOperation: jest.fn().mockReturnValue(true),
      } as unknown as CheckpointManager;

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        mockStorage,
      );

      const response = await request(server)
        .post(
          `${API_PATHS.UPDATE_CHECKPOINT_DATA}/${executionId}/${operationId}`,
        )
        .send({
          operationData: {
            Status: status,
            StepDetails: {
              Result: "hello world",
            },
          },
        });

      expect(response.body).toEqual({
        operation: mockUpdatedOperation,
      });
      expect(response.status).toBe(200);
      expect(
        mockExecutionManager.getCheckpointsByExecution,
      ).toHaveBeenCalledWith(executionId);
      expect(mockStorage.updateOperation).toHaveBeenCalledWith(
        operationId,
        {
          Status: status,
          StepDetails: {
            Result: "hello world",
          },
        },
        undefined,
        undefined,
      );
    });

    it("should return 500 when execution does not exist", async () => {
      const executionId = "non-existent-id";
      const operationId = "test-operation-id";

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        undefined,
      );

      const response = await request(server)
        .post(
          `${API_PATHS.UPDATE_CHECKPOINT_DATA}/${executionId}/${operationId}`,
        )
        .send({
          operationData: {
            Status: OperationStatus.SUCCEEDED,
            StepDetails: {
              Result: "hello world",
            },
          },
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: "Execution not found" });
    });

    it("should return 500 when operation does not exist", async () => {
      const executionId = "test-execution-id";
      const operationId = "non-existent-op-id";
      const mockOperationData = {
        operation: { Id: operationId, Status: OperationStatus.SUCCEEDED },
        update: { Id: operationId },
      };

      const mockStorage = {
        completeOperation: jest.fn().mockReturnValue(mockOperationData),
        hasOperation: jest.fn().mockReturnValue(false),
      } as unknown as CheckpointManager;

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        mockStorage,
      );

      const response = await request(server)
        .post(
          `${API_PATHS.UPDATE_CHECKPOINT_DATA}/${executionId}/${operationId}`,
        )
        .send({
          operationData: {
            Status: OperationStatus.SUCCEEDED,
          },
        });

      expect(response.body).toEqual({ message: "Operation not found" });
      expect(response.status).toBe(500);
    });

    it("should pass payload parameter to updateOperation when provided", async () => {
      const executionId = "test-execution-id";
      const operationId = "test-operation-id";
      const status = OperationStatus.SUCCEEDED;
      const payload = JSON.stringify({ result: "test payload data" });

      const mockUpdatedOperation = {
        Id: operationId,
        Status: OperationStatus.SUCCEEDED,
      };

      const mockStorage = {
        updateOperation: jest.fn().mockReturnValue(mockUpdatedOperation),
        hasOperation: jest.fn().mockReturnValue(true),
      } as unknown as CheckpointManager;

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        mockStorage,
      );

      const response = await request(server)
        .post(
          `${API_PATHS.UPDATE_CHECKPOINT_DATA}/${executionId}/${operationId}`,
        )
        .send({
          operationData: {
            Status: status,
            StepDetails: {
              Result: "hello world",
            },
          },
          payload: payload,
        });

      expect(response.body).toEqual({
        operation: mockUpdatedOperation,
      });
      expect(response.status).toBe(200);
      expect(mockStorage.updateOperation).toHaveBeenCalledWith(
        operationId,
        {
          Status: status,
          StepDetails: {
            Result: "hello world",
          },
        },
        payload,
        undefined,
      );
    });

    it("should pass error parameter to updateOperation when provided", async () => {
      const executionId = "test-execution-id";
      const operationId = "test-operation-id";
      const status = OperationStatus.FAILED;
      const errorObject = {
        ErrorType: "ServiceException",
        ErrorMessage: "Operation failed",
      };

      const mockUpdatedOperation = {
        Id: operationId,
        Status: OperationStatus.FAILED,
      };

      const mockStorage = {
        updateOperation: jest.fn().mockReturnValue(mockUpdatedOperation),
        hasOperation: jest.fn().mockReturnValue(true),
      } as unknown as CheckpointManager;

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        mockStorage,
      );

      const response = await request(server)
        .post(
          `${API_PATHS.UPDATE_CHECKPOINT_DATA}/${executionId}/${operationId}`,
        )
        .send({
          operationData: {
            Status: status,
            StepDetails: {
              Error: errorObject,
            },
          },
          error: errorObject,
        });

      expect(response.body).toEqual({
        operation: mockUpdatedOperation,
      });
      expect(response.status).toBe(200);
      expect(mockStorage.updateOperation).toHaveBeenCalledWith(
        operationId,
        {
          Status: status,
          StepDetails: {
            Error: errorObject,
          },
        },
        undefined,
        errorObject,
      );
    });

    it("should pass both payload and error parameters to updateOperation when provided", async () => {
      const executionId = "test-execution-id";
      const operationId = "test-operation-id";
      const status = OperationStatus.FAILED;
      const payload = JSON.stringify({ attemptedValue: "some data" });
      const errorObject = {
        ErrorType: "ValidationException",
        ErrorMessage: "Invalid input data",
      };

      const mockUpdatedOperation = {
        Id: operationId,
        Status: OperationStatus.FAILED,
      };

      const mockStorage = {
        updateOperation: jest.fn().mockReturnValue(mockUpdatedOperation),
        hasOperation: jest.fn().mockReturnValue(true),
      } as unknown as CheckpointManager;

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        mockStorage,
      );

      const response = await request(server)
        .post(
          `${API_PATHS.UPDATE_CHECKPOINT_DATA}/${executionId}/${operationId}`,
        )
        .send({
          operationData: {
            Status: status,
          },
          payload: payload,
          error: errorObject,
        });

      expect(response.body).toEqual({
        operation: mockUpdatedOperation,
      });
      expect(response.status).toBe(200);
      expect(mockStorage.updateOperation).toHaveBeenCalledWith(
        operationId,
        {
          Status: status,
        },
        payload,
        errorObject,
      );
    });

    it("should pass undefined for payload and error when not provided", async () => {
      const executionId = "test-execution-id";
      const operationId = "test-operation-id";
      const status = OperationStatus.SUCCEEDED;

      const mockUpdatedOperation = {
        Id: operationId,
        Status: OperationStatus.SUCCEEDED,
      };

      const mockStorage = {
        updateOperation: jest.fn().mockReturnValue(mockUpdatedOperation),
        hasOperation: jest.fn().mockReturnValue(true),
      } as unknown as CheckpointManager;

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        mockStorage,
      );

      const response = await request(server)
        .post(
          `${API_PATHS.UPDATE_CHECKPOINT_DATA}/${executionId}/${operationId}`,
        )
        .send({
          operationData: {
            Status: status,
          },
        });

      expect(response.body).toEqual({
        operation: mockUpdatedOperation,
      });
      expect(response.status).toBe(200);
      expect(mockStorage.updateOperation).toHaveBeenCalledWith(
        operationId,
        {
          Status: status,
        },
        undefined,
        undefined,
      );
    });
  });

  describe(`${API_PATHS.GET_STATE}/:durableExecutionArn/getState`, () => {
    it("should return operations when execution exists", async () => {
      const tokenData: CheckpointTokenData = {
        executionId: "test-execution-id" as unknown as ExecutionId,
        invocationId: "test-invocation-id" as unknown as InvocationId,
        token: "test-token",
      };
      const durableExecutionArn = tokenData.executionId;

      const mockOperations: Operation[] = [
        {
          Id: "op1",
          Type: OperationType.STEP,
          Status: OperationStatus.SUCCEEDED,
        } as Operation,
        {
          Id: "op2",
          Type: OperationType.WAIT,
          Status: OperationStatus.STARTED,
        } as Operation,
      ];

      const mockStorage = {
        getState: jest.fn().mockReturnValue(mockOperations),
      };

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        mockStorage as unknown as CheckpointManager,
      );

      const response = await request(server).get(
        `${API_PATHS.GET_STATE}/${durableExecutionArn}/state`,
      );

      expect(response.status).toBe(200);
      expect(
        mockExecutionManager.getCheckpointsByExecution,
      ).toHaveBeenCalledWith(durableExecutionArn);
      expect(response.body).toEqual({
        Operations: mockOperations,
        NextMarker: undefined,
      });
    });

    it("should return 500 when execution does not exist", async () => {
      const invalidExecutionId = "invalid-id" as ExecutionId;

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        undefined,
      );

      const response = await request(server).get(
        `${API_PATHS.GET_STATE}/${invalidExecutionId}/state`,
      );

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: "Execution not found" });
    });
  });

  describe(`${API_PATHS.CHECKPOINT}/:durableExecutionArn/checkpoint`, () => {
    it("should handle undefined updates array", async () => {
      const tokenData: CheckpointTokenData = {
        executionId: createExecutionId("test-execution-id"),
        invocationId: createInvocationId("test-invocation-id"),
        token: "test-token",
      };
      const durableExecutionArn = tokenData.executionId;
      const checkpointToken = encodeCheckpointToken(tokenData);

      const mockOperations: Operation[] = [
        {
          Id: "op1",
          Type: OperationType.STEP,
          Status: OperationStatus.SUCCEEDED,
        } as Operation,
      ];

      const mockStorage = {
        registerUpdates: jest.fn().mockReturnValue([]),
        operationDataMap: new Map([["op1", { operation: mockOperations[0] }]]),
      };

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        mockStorage as unknown as CheckpointManager,
      );

      // Send request with no updates field
      const input: Partial<CheckpointDurableExecutionRequest> = {
        CheckpointToken: checkpointToken,
      };

      const response = await request(server)
        .post(`${API_PATHS.CHECKPOINT}/${durableExecutionArn}/checkpoint`)
        .send(input);

      expect(response.status).toBe(200);
      expect(
        mockExecutionManager.getCheckpointsByExecution,
      ).toHaveBeenCalledWith(durableExecutionArn);
      // registerUpdates should be called with empty array when no Updates field is provided
      expect(mockStorage.registerUpdates).toHaveBeenCalledWith([]);
      expect(response.body).toEqual({
        CheckpointToken: expect.any(String),
        NewExecutionState: {
          Operations: mockOperations,
          NextMarker: undefined,
        },
      });
    });

    it("should register updates and return updated operations", async () => {
      const tokenData: CheckpointTokenData = {
        executionId: createExecutionId("test-execution-id"),
        invocationId: createInvocationId("test-invocation-id"),
        token: "test-token",
      };
      const durableExecutionArn = tokenData.executionId;
      const checkpointToken = encodeCheckpointToken(tokenData);

      const mockOperations: Operation[] = [
        {
          Id: "op1",
          Type: OperationType.STEP,
          Status: OperationStatus.SUCCEEDED,
        } as Operation,
        {
          Id: "op2",
          Type: OperationType.WAIT,
          Status: OperationStatus.STARTED,
        } as Operation,
      ];

      const mockStorage = {
        registerUpdates: jest.fn().mockReturnValue([]),
        operationDataMap: new Map([
          ["op1", { operation: mockOperations[0] }],
          ["op2", { operation: mockOperations[1] }],
        ]),
      };

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        mockStorage as unknown as CheckpointManager,
      );

      const input: CheckpointDurableExecutionRequest = {
        DurableExecutionArn: durableExecutionArn,
        CheckpointToken: checkpointToken,
        Updates: [
          {
            Id: "new-op",
            Type: OperationType.STEP,
            Action: OperationAction.START,
          },
        ],
      };

      const response = await request(server)
        .post(`${API_PATHS.CHECKPOINT}/${durableExecutionArn}/checkpoint`)
        .send(input);

      expect(response.status).toBe(200);
      expect(
        mockExecutionManager.getCheckpointsByExecution,
      ).toHaveBeenCalledWith(durableExecutionArn);
      expect(mockStorage.registerUpdates).toHaveBeenCalledWith(input.Updates);
      expect(response.body).toEqual({
        CheckpointToken: expect.any(String),
        NewExecutionState: {
          Operations: mockOperations,
          NextMarker: undefined,
        },
      });
    });

    it("should handle server-side STEP operation processing with payload", async () => {
      const tokenData: CheckpointTokenData = {
        executionId: createExecutionId("test-execution-id"),
        invocationId: createInvocationId("test-invocation-id"),
        token: "test-token",
      };
      const durableExecutionArn = tokenData.executionId;
      const checkpointToken = encodeCheckpointToken(tokenData);

      const mockOperations: Operation[] = [
        {
          Id: "step-op",
          Type: OperationType.STEP,
          Status: OperationStatus.STARTED,
          StepDetails: {
            Result: JSON.stringify({ processed: true, value: 42 }),
            Attempt: 0,
          },
        } as Operation,
      ];

      const mockStorage = {
        registerUpdates: jest.fn().mockReturnValue([]),
        operationDataMap: new Map([
          ["step-op", { operation: mockOperations[0] }],
        ]),
      };

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        mockStorage as unknown as CheckpointManager,
      );

      const input: CheckpointDurableExecutionRequest = {
        DurableExecutionArn: durableExecutionArn,
        CheckpointToken: checkpointToken,
        Updates: [
          {
            Id: "step-op",
            Type: OperationType.STEP,
            Payload: JSON.stringify({ processed: true, value: 42 }),
            Action: "SUCCEED",
          },
        ],
      };

      const response = await request(server)
        .post(`${API_PATHS.CHECKPOINT}/${durableExecutionArn}/checkpoint`)
        .send(input);

      expect(response.status).toBe(200);
      expect(mockStorage.registerUpdates).toHaveBeenCalledWith(input.Updates);
      expect(response.body).toEqual({
        CheckpointToken: expect.any(String),
        NewExecutionState: {
          Operations: mockOperations,
          NextMarker: undefined,
        },
      });
    });

    it("should handle multiple operation updates in a single checkpoint", async () => {
      const tokenData: CheckpointTokenData = {
        executionId: createExecutionId("test-execution-id"),
        invocationId: createInvocationId("test-invocation-id"),
        token: "test-token",
      };
      const durableExecutionArn = tokenData.executionId;
      const checkpointToken = encodeCheckpointToken(tokenData);

      const mockOperations: Operation[] = [
        {
          Id: "step1",
          Type: OperationType.STEP,
          Status: OperationStatus.STARTED,
        } as Operation,
        {
          Id: "step2",
          Type: OperationType.STEP,
          Status: OperationStatus.STARTED,
        } as Operation,
      ];

      const mockStorage = {
        registerUpdates: jest.fn().mockReturnValue([]),
        operationDataMap: new Map([
          ["step1", { operation: mockOperations[0] }],
          ["step2", { operation: mockOperations[1] }],
        ]),
      };

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        mockStorage as unknown as CheckpointManager,
      );

      const input: CheckpointDurableExecutionRequest = {
        DurableExecutionArn: durableExecutionArn,
        CheckpointToken: checkpointToken,
        Updates: [
          {
            Id: "step1",
            Type: OperationType.STEP,
            Payload: JSON.stringify({ result: "first" }),
            Action: "SUCCEED",
          },
          {
            Id: "step2",
            Type: OperationType.STEP,
            Payload: JSON.stringify({ result: "second" }),
            Action: "SUCCEED",
          },
        ],
      };

      const response = await request(server)
        .post(`${API_PATHS.CHECKPOINT}/${durableExecutionArn}/checkpoint`)
        .send(input);

      expect(response.status).toBe(200);
      expect(mockStorage.registerUpdates).toHaveBeenCalledWith(input.Updates);
    });

    it("should return 500 when execution does not exist", async () => {
      const invalidExecutionId = "invalid-id" as ExecutionId;

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        undefined,
      );

      const response = await request(server)
        .post(`${API_PATHS.CHECKPOINT}/${invalidExecutionId}/checkpoint`)
        .send({});

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: "Execution not found" });
    });

    it("should return 500 when checkpoint update is invalid", async () => {
      const tokenData: CheckpointTokenData = {
        executionId: createExecutionId("test-execution-id"),
        invocationId: createInvocationId("test-invocation-id"),
        token: "test-token",
      };
      const durableExecutionArn = tokenData.executionId;
      const checkpointToken = encodeCheckpointToken(tokenData);

      const mockOperations: Operation[] = [
        {
          Id: "op1",
          Type: OperationType.STEP,
          Status: OperationStatus.SUCCEEDED,
        } as Operation,
        {
          Id: "op2",
          Type: OperationType.WAIT,
          Status: OperationStatus.STARTED,
        } as Operation,
      ];

      const mockStorage = {
        registerUpdates: jest.fn().mockReturnValue([]),
        operationDataMap: new Map([
          ["op1", { operation: mockOperations[0] }],
          ["op2", { operation: mockOperations[1] }],
        ]),
      };

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        mockStorage as unknown as CheckpointManager,
      );

      const input: CheckpointDurableExecutionRequest = {
        DurableExecutionArn: durableExecutionArn,
        CheckpointToken: checkpointToken,
        Updates: [
          {
            Id: "op1",
            Type: OperationType.STEP,
            // op1 already succeeded so this is invalid
            Action: OperationAction.START,
          },
        ],
      };

      const response = await request(server)
        .post(`${API_PATHS.CHECKPOINT}/${durableExecutionArn}/checkpoint`)
        .send(input);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        message: "Invalid current STEP state to start.",
      });
    });
  });

  describe("Callback endpoints", () => {
    describe(`POST ${API_PATHS.CALLBACKS}/:callbackId/succeed`, () => {
      it("should complete callback successfully with raw buffer data", async () => {
        const callbackId = "test-callback-id";
        const mockCheckpointManager = {
          completeCallback: jest.fn(),
          heartbeatCallback: jest.fn(),
        } as unknown as CheckpointManager;

        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          mockCheckpointManager,
        );

        const rawData = "success-result";

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/succeed`)
          .set("Content-Type", "application/octet-stream")
          .send(rawData);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({});
        expect(
          mockExecutionManager.getCheckpointsByCallbackId,
        ).toHaveBeenCalledWith(callbackId);
        expect(mockCheckpointManager.completeCallback).toHaveBeenCalledWith(
          {
            CallbackId: callbackId,
            Result: "success-result",
          },
          OperationStatus.SUCCEEDED,
        );
      });

      it("should complete callback successfully with Buffer input", async () => {
        const callbackId = "test-callback-id";
        const mockCheckpointManager = {
          completeCallback: jest.fn(),
        } as unknown as CheckpointManager;

        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          mockCheckpointManager,
        );

        const bufferData = Buffer.from("buffer-content", "utf-8");

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/succeed`)
          .set("Content-Type", "application/octet-stream")
          .send(bufferData);

        expect(response.status).toBe(200);
        expect(mockCheckpointManager.completeCallback).toHaveBeenCalledWith(
          {
            CallbackId: callbackId,
            Result: "buffer-content",
          },
          OperationStatus.SUCCEEDED,
        );
      });

      it("should complete callback successfully with undefined input", async () => {
        const callbackId = "test-callback-id";
        const mockCheckpointManager = {
          completeCallback: jest.fn(),
        } as unknown as CheckpointManager;

        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          mockCheckpointManager,
        );

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/succeed`)
          .set("Content-Type", "application/octet-stream")
          .send(undefined);

        expect(response.status).toBe(200);
        expect(mockCheckpointManager.completeCallback).toHaveBeenCalledWith(
          {
            CallbackId: callbackId,
            Result: undefined,
          },
          OperationStatus.SUCCEEDED,
        );
      });

      it("should return 500 when execution not found", async () => {
        const callbackId = "test-callback-id";
        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          undefined,
        );

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/succeed`)
          .set("Content-Type", "application/octet-stream")
          .send("result");

        expect(response.status).toBe(500);
        expect(response.body).toEqual({
          message: "Execution not found",
        });
      });

      it("should return 500 when parameter is not a buffer", async () => {
        const callbackId = "test-callback-id";
        const mockCheckpointManager = {
          completeCallback: jest.fn(),
        } as unknown as CheckpointManager;
        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          mockCheckpointManager,
        );

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/succeed`)
          .send("result");

        expect(response.status).toBe(500);
        expect(response.body).toEqual({
          message: "Invalid buffer input",
        });
      });

      it("should return 500 for InvalidParameterValueException", async () => {
        const callbackId = "test-callback-id";
        const mockCheckpointManager = {
          completeCallback: jest.fn().mockImplementation(() => {
            throw new InvalidParameterValueException({
              message: "Invalid callback parameters",
              $metadata: {},
            });
          }),
        } as unknown as CheckpointManager;

        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          mockCheckpointManager,
        );

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/succeed`)
          .set("Content-Type", "application/octet-stream")
          .send("result");

        expect(response.status).toBe(500);
        expect(response.body).toEqual({
          message: "Invalid callback parameters",
        });
      });
    });

    describe(`POST ${API_PATHS.CALLBACKS}/:callbackId/fail`, () => {
      it("should complete callback with failure successfully", async () => {
        const callbackId = "test-callback-id";
        const mockCheckpointManager = {
          completeCallback: jest.fn(),
        } as unknown as CheckpointManager;

        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          mockCheckpointManager,
        );

        const errorObject = {
          Code: "ServiceException",
          Message: "callback-failed-error",
        };

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/fail`)
          .send(errorObject);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({});
        expect(
          mockExecutionManager.getCheckpointsByCallbackId,
        ).toHaveBeenCalledWith(callbackId);
        expect(mockCheckpointManager.completeCallback).toHaveBeenCalledWith(
          {
            CallbackId: callbackId,
            Error: errorObject,
          },
          OperationStatus.FAILED,
        );
      });

      it("should complete callback with string error", async () => {
        const callbackId = "test-callback-id";
        const mockCheckpointManager = {
          completeCallback: jest.fn(),
        } as unknown as CheckpointManager;

        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          mockCheckpointManager,
        );

        const simpleError = "Simple error message";

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/fail`)
          .send({
            ErrorMessage: simpleError,
          });

        expect(response.status).toBe(200);
        expect(mockCheckpointManager.completeCallback).toHaveBeenCalledWith(
          {
            CallbackId: callbackId,
            Error: {
              ErrorMessage: simpleError,
            },
          },
          OperationStatus.FAILED,
        );
      });

      it("should return 500 when execution not found", async () => {
        const callbackId = "test-callback-id";
        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          undefined,
        );

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/fail`)
          .send({ CallbackId: callbackId, Error: "error" });

        expect(response.status).toBe(500);
        expect(response.body).toEqual({
          message: "Execution not found",
        });
      });

      it("should return 500 for InvalidParameterValueException", async () => {
        const callbackId = "test-callback-id";
        const mockCheckpointManager = {
          completeCallback: jest.fn().mockImplementation(() => {
            throw new InvalidParameterValueException({
              message: "Invalid callback parameters",
              $metadata: {},
            });
          }),
        } as unknown as CheckpointManager;

        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          mockCheckpointManager,
        );

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/fail`)
          .send({ ErrorMessage: "test error" });

        expect(response.status).toBe(500);
        expect(response.body).toEqual({
          message: "Invalid callback parameters",
        });
      });
    });

    describe(`POST ${API_PATHS.CALLBACKS}/:callbackId/heartbeat`, () => {
      it("should process callback heartbeat successfully", async () => {
        const callbackId = "test-callback-id";
        const mockCheckpointManager = {
          heartbeatCallback: jest.fn(),
        } as unknown as CheckpointManager;

        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          mockCheckpointManager,
        );

        const heartbeatInput: SendDurableExecutionCallbackHeartbeatRequest = {
          CallbackId: callbackId,
        };

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/heartbeat`)
          .send(heartbeatInput);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({});
        expect(
          mockExecutionManager.getCheckpointsByCallbackId,
        ).toHaveBeenCalledWith(callbackId);
        expect(mockCheckpointManager.heartbeatCallback).toHaveBeenCalledWith(
          callbackId,
        );
      });

      it("should return 500 when execution not found", async () => {
        const callbackId = "test-callback-id";
        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          undefined,
        );

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/heartbeat`)
          .send({ CallbackId: callbackId });

        expect(response.status).toBe(500);
        expect(response.body).toEqual({
          message: "Execution not found",
        });
      });

      it("should return 500 for InvalidParameterValueException", async () => {
        const callbackId = "test-callback-id";
        const mockCheckpointManager = {
          heartbeatCallback: jest.fn().mockImplementation(() => {
            throw new InvalidParameterValueException({
              message: "Invalid callback parameters",
              $metadata: {},
            });
          }),
        } as unknown as CheckpointManager;

        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          mockCheckpointManager,
        );

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/heartbeat`)
          .send({ CallbackId: callbackId });

        expect(response.status).toBe(500);
        expect(response.body).toEqual({
          message: "Invalid callback parameters",
        });
      });
    });
  });

  describe("404 handler", () => {
    it("should return 404 for non-existent routes", async () => {
      const response = await request(server).get("/non-existent-route");

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: "Not found" });
    });
  });
});
