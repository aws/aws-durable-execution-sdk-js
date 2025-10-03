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
        operations: [],
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
        operations: [],
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
        operations: [],
      });

      const response = await request(server).post(
        `${API_PATHS.START_INVOCATION}/${executionId}`
      );

      expect(response.status).toBe(200);
      expect(mockExecutionManager.startInvocation).toHaveBeenCalledWith(
        expect.any(String)
      );
      expect(response.body).toEqual({
        checkpointToken: "mockToken",
        executionId,
        invocationId: "mockInvocationId",
        operations: [],
      });
    });
  });

  describe(`${API_PATHS.POLL_CHECKPOINT_DATA}/:executionId`, () => {
    it("should return pending checkpoint updates when execution exists", async () => {
      const executionId = "test-execution-id";
      const mockStorage = new CheckpointManager(
        createExecutionId("test-execution-id")
      );
      jest
        .spyOn(mockStorage, "getPendingCheckpointUpdates")
        .mockResolvedValueOnce([
          {
            operation: { Id: "op1", Type: OperationType.STEP },
            update: { Id: "op1", Type: OperationType.STEP },
            events: [],
          },
        ]);

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        mockStorage
      );

      const response = await request(server).get(
        `${API_PATHS.POLL_CHECKPOINT_DATA}/${executionId}`
      );

      expect(response.status).toBe(200);
      expect(
        mockExecutionManager.getCheckpointsByExecution
      ).toHaveBeenCalledWith(executionId);
      expect(mockStorage.getPendingCheckpointUpdates).toHaveBeenCalled();
      expect(response.body).toEqual({
        operations: [
          {
            events: [],
            operation: { Id: "op1", Type: OperationType.STEP },
            update: { Id: "op1", Type: OperationType.STEP },
          },
        ],
      });
    });

    it("should return 404 when execution does not exist", async () => {
      const executionId = "non-existent-id";

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        undefined
      );

      const response = await request(server).get(
        `${API_PATHS.POLL_CHECKPOINT_DATA}/${executionId}`
      );

      expect(response.status).toBe(404);
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
        mockStorage
      );

      const response = await request(server)
        .post(
          `${API_PATHS.UPDATE_CHECKPOINT_DATA}/${executionId}/${operationId}`
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
        mockExecutionManager.getCheckpointsByExecution
      ).toHaveBeenCalledWith(executionId);
      expect(mockStorage.updateOperation).toHaveBeenCalledWith(operationId, {
        Status: status,
        StepDetails: {
          Result: "hello world",
        },
      });
    });

    it("should return 404 when execution does not exist", async () => {
      const executionId = "non-existent-id";
      const operationId = "test-operation-id";

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        undefined
      );

      const response = await request(server)
        .post(
          `${API_PATHS.UPDATE_CHECKPOINT_DATA}/${executionId}/${operationId}`
        )
        .send({
          operationData: {
            Status: OperationStatus.SUCCEEDED,
            StepDetails: {
              Result: "hello world",
            },
          },
        });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: "Execution not found" });
    });

    it("should return 404 when operation does not exist", async () => {
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
        mockStorage
      );

      const response = await request(server)
        .post(
          `${API_PATHS.UPDATE_CHECKPOINT_DATA}/${executionId}/${operationId}`
        )
        .send({
          operationData: {
            Status: OperationStatus.SUCCEEDED,
          },
        });

      expect(response.body).toEqual({ message: "Operation not found" });
      expect(response.status).toBe(404);
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
        mockStorage as unknown as CheckpointManager
      );

      const response = await request(server).get(
        `${API_PATHS.GET_STATE}/${durableExecutionArn}/state`
      );

      expect(response.status).toBe(200);
      expect(
        mockExecutionManager.getCheckpointsByExecution
      ).toHaveBeenCalledWith(durableExecutionArn);
      expect(response.body).toEqual({
        Operations: mockOperations,
        NextMarker: undefined,
      });
    });

    it("should return 404 when execution does not exist", async () => {
      const invalidExecutionId = "invalid-id" as ExecutionId;

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        undefined
      );

      const response = await request(server).get(
        `${API_PATHS.GET_STATE}/${invalidExecutionId}/state`
      );

      expect(response.status).toBe(404);
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
        mockStorage as unknown as CheckpointManager
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
        mockExecutionManager.getCheckpointsByExecution
      ).toHaveBeenCalledWith(durableExecutionArn);
      // registerUpdates should be called with empty array when no Updates field is provided
      expect(mockStorage.registerUpdates).toHaveBeenCalledWith(
        [],
        "test-invocation-id"
      );
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
        mockStorage as unknown as CheckpointManager
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
        mockExecutionManager.getCheckpointsByExecution
      ).toHaveBeenCalledWith(durableExecutionArn);
      expect(mockStorage.registerUpdates).toHaveBeenCalledWith(
        input.Updates,
        "test-invocation-id"
      );
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
        mockStorage as unknown as CheckpointManager
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
      expect(mockStorage.registerUpdates).toHaveBeenCalledWith(
        input.Updates,
        "test-invocation-id"
      );
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
        mockStorage as unknown as CheckpointManager
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
      expect(mockStorage.registerUpdates).toHaveBeenCalledWith(
        input.Updates,
        "test-invocation-id"
      );
    });

    it("should return 404 when execution does not exist", async () => {
      const invalidExecutionId = "invalid-id" as ExecutionId;

      mockExecutionManager.getCheckpointsByExecution.mockReturnValueOnce(
        undefined
      );

      const response = await request(server)
        .post(`${API_PATHS.CHECKPOINT}/${invalidExecutionId}/checkpoint`)
        .send({});

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: "Execution not found" });
    });

    it("should return 400 when checkpoint update is invalid", async () => {
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
        mockStorage as unknown as CheckpointManager
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

      expect(response.status).toBe(400);
      expect(response.headers["x-amzn-errortype"]).toEqual(
        "InvalidParameterValueException"
      );
      expect(response.body).toEqual({
        Type: "InvalidParameterValueException",
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
          mockCheckpointManager
        );

        const rawData = "success-result";

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/succeed`)
          .set("Content-Type", "application/octet-stream")
          .send(rawData);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({});
        expect(
          mockExecutionManager.getCheckpointsByCallbackId
        ).toHaveBeenCalledWith(callbackId);
        expect(mockCheckpointManager.completeCallback).toHaveBeenCalledWith(
          {
            CallbackId: callbackId,
            Result: "success-result",
          },
          OperationStatus.SUCCEEDED
        );
      });

      it("should complete callback successfully with Buffer input", async () => {
        const callbackId = "test-callback-id";
        const mockCheckpointManager = {
          completeCallback: jest.fn(),
        } as unknown as CheckpointManager;

        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          mockCheckpointManager
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
          OperationStatus.SUCCEEDED
        );
      });

      it("should complete callback successfully with undefined input", async () => {
        const callbackId = "test-callback-id";
        const mockCheckpointManager = {
          completeCallback: jest.fn(),
        } as unknown as CheckpointManager;

        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          mockCheckpointManager
        );

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/succeed`)
          .set("Content-Type", "application/octet-stream")
          .send(undefined);

        expect(response.status).toBe(200);
        expect(mockCheckpointManager.completeCallback).toHaveBeenCalledWith(
          {
            CallbackId: callbackId,
            Result: "",
          },
          OperationStatus.SUCCEEDED
        );
      });

      it("should return 404 when execution not found", async () => {
        const callbackId = "test-callback-id";
        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          undefined
        );

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/succeed`)
          .set("Content-Type", "application/octet-stream")
          .send("result");

        expect(response.status).toBe(404);
        expect(response.body).toEqual({
          message: "Execution not found",
        });
      });

      it("should return 400 when parameter is not a buffer", async () => {
        const callbackId = "test-callback-id";
        const mockCheckpointManager = {
          completeCallback: jest.fn(),
        } as unknown as CheckpointManager;
        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          mockCheckpointManager
        );

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/succeed`)
          .send("result");

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
          message: "Invalid buffer input",
        });
      });

      it("should return 400 for InvalidParameterValueException", async () => {
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
          mockCheckpointManager
        );

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/succeed`)
          .set("Content-Type", "application/octet-stream")
          .send("result");

        expect(response.status).toBe(400);
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
          mockCheckpointManager
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
          mockExecutionManager.getCheckpointsByCallbackId
        ).toHaveBeenCalledWith(callbackId);
        expect(mockCheckpointManager.completeCallback).toHaveBeenCalledWith(
          {
            CallbackId: callbackId,
            Error: errorObject,
          },
          OperationStatus.FAILED
        );
      });

      it("should complete callback with string error", async () => {
        const callbackId = "test-callback-id";
        const mockCheckpointManager = {
          completeCallback: jest.fn(),
        } as unknown as CheckpointManager;

        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          mockCheckpointManager
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
          OperationStatus.FAILED
        );
      });

      it("should return 404 when execution not found", async () => {
        const callbackId = "test-callback-id";
        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          undefined
        );

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/fail`)
          .send({ CallbackId: callbackId, Error: "error" });

        expect(response.status).toBe(404);
        expect(response.body).toEqual({
          message: "Execution not found",
        });
      });

      it("should return 400 for InvalidParameterValueException", async () => {
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
          mockCheckpointManager
        );

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/fail`)
          .send({ ErrorMessage: "test error" });

        expect(response.status).toBe(400);
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
          mockCheckpointManager
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
          mockExecutionManager.getCheckpointsByCallbackId
        ).toHaveBeenCalledWith(callbackId);
        expect(mockCheckpointManager.heartbeatCallback).toHaveBeenCalledWith(
          callbackId
        );
      });

      it("should return 404 when execution not found", async () => {
        const callbackId = "test-callback-id";
        mockExecutionManager.getCheckpointsByCallbackId.mockReturnValue(
          undefined
        );

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/heartbeat`)
          .send({ CallbackId: callbackId });

        expect(response.status).toBe(404);
        expect(response.body).toEqual({
          message: "Execution not found",
        });
      });

      it("should return 400 for InvalidParameterValueException", async () => {
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
          mockCheckpointManager
        );

        const response = await request(server)
          .post(`${API_PATHS.CALLBACKS}/${callbackId}/heartbeat`)
          .send({ CallbackId: callbackId });

        expect(response.status).toBe(400);
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
