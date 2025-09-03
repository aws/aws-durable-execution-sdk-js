import {
  CheckpointDurableExecutionCommand,
  CheckpointDurableExecutionRequest,
  LambdaClient,
  GetDurableExecutionStateCommand,
  OperationAction,
  OperationType,
} from "@amzn/dex-internal-sdk";
import {
  DurableExecutionInvocationInput,
  DurableExecutionInvocationOutput,
  InvocationStatus,
  OperationSubType,
} from "../types";
import { log } from "../utils/logger/logger";
import { ApiStorage } from "./api-storage";
import { RecordDefinitionStorage } from "./record-definition-storage";

// Mock the Durable Executions Client
jest.mock("@amzn/dex-internal-sdk", () => {
  const originalModule = jest.requireActual("@amzn/dex-internal-sdk");
  return {
    ...originalModule,
    LambdaClient: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
    CheckpointDurableExecutionCommand: jest.fn(),
    GetDurableExecutionStateCommand: jest.fn(),
  };
});

jest.mock("../utils/logger/logger", () => ({
  log: jest.fn(),
}));

describe("RecordDefinitionStorage", () => {
  const endpoint: string = "https://custom-endpoint.com";
  let recordDefinitionStorage: RecordDefinitionStorage;
  let durableExecutionsClient: { send: jest.Mock };

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Set required environment variables
    process.env.DEX_ENDPOINT = endpoint;
    process.env.DEX_REGION = "us-east-1";

    // Create a new instance of RecordDefinitionStorage
    recordDefinitionStorage = new RecordDefinitionStorage();

    // Get the mocked SWFClient instance
    durableExecutionsClient = (LambdaClient as jest.Mock).mock.results[0].value;
  });

  test("should initialize with correct endpoint and region", () => {
    // Verify that LambdaClient was constructed with the correct parameters
    expect(LambdaClient).toHaveBeenCalledWith({
      endpoint: expect.any(String),
      region: expect.any(String),
      credentials: expect.any(Function),
    });
  });

  test("should use environment variables for endpoint and region if available", () => {
    // Save original environment
    const originalEnv = process.env;

    try {
      // Set environment variables
      process.env.DEX_ENDPOINT = endpoint;
      process.env.DEX_REGION = "eu-west-1";

      // Create a new instance
      new ApiStorage();

      // Verify that LambdaClient was constructed with the environment variables
      expect(LambdaClient).toHaveBeenCalledWith({
        endpoint: "https://custom-endpoint.com",
        region: "eu-west-1",
        credentials: expect.any(Function),
      });
    } finally {
      // Restore original environment
      process.env = originalEnv;
    }
  });

  test("should call getStepData with correct parameters", async () => {
    // Setup mock response
    const mockResponse = { _stepData: [] };
    durableExecutionsClient.send.mockResolvedValue(mockResponse);

    // Call getStepData
    const result = await recordDefinitionStorage.getStepData(
      "task-token",
      "next-token",
    );

    // Verify that GetDurableExecutionStateCommand was constructed with the correct parameters
    expect(GetDurableExecutionStateCommand).toHaveBeenCalledWith({
      CheckpointToken: "task-token",
      Marker: "next-token",
      MaxItems: 1000,
    });

    // Verify that send was called with the GetStateCommand
    expect(durableExecutionsClient.send).toHaveBeenCalledWith(
      expect.any(GetDurableExecutionStateCommand),
    );

    // Verify the result
    expect(result).toBe(mockResponse);
  });

  test("should call checkpoint with correct parameters", async () => {
    // Setup mock response
    const mockResponse = { taskToken: "new-task-token" };
    durableExecutionsClient.send.mockResolvedValue(mockResponse);

    // Create checkpoint data
    const checkpointData: CheckpointDurableExecutionRequest = {
      CheckpointToken: "",
      Updates: [
        {
          Id: "step-id",
          SubType: OperationSubType.STEP,
          Type: OperationType.STEP,
          Action: OperationAction.START,
        },
      ],
    };

    // Call checkpoint
    const result = await recordDefinitionStorage.checkpoint(
      "task-token",
      checkpointData,
    );

    // Verify that CheckpointDurableExecutionCommand was constructed with the correct parameters
    expect(CheckpointDurableExecutionCommand).toHaveBeenCalledWith({
      CheckpointToken: "task-token",
      Updates: checkpointData.Updates,
      ClientToken: checkpointData.ClientToken,
    });

    // Verify that send was called with the CheckpointCommand
    expect(durableExecutionsClient.send).toHaveBeenCalledWith(
      expect.any(CheckpointDurableExecutionCommand),
    );

    // Verify the result
    expect(result).toBe(mockResponse);
  });

  test("should propagate errors from SWFClient", async () => {
    // Setup mock error
    const mockError = new Error("SWF client error");
    durableExecutionsClient.send.mockRejectedValue(mockError);

    // Call getStepData and expect it to throw
    await expect(
      recordDefinitionStorage.getStepData("task-token", "next-token"),
    ).rejects.toThrow("SWF client error");

    // Call checkpoint and expect it to throw
    await expect(
      recordDefinitionStorage.checkpoint("task-token", {
        CheckpointToken: "",
      }),
    ).rejects.toThrow("SWF client error");
  });

  test("should log invocation definition when calling complete", async () => {
    // Setup mock response
    const mockCheckpointResponse = { taskToken: "new-task-token" };
    durableExecutionsClient.send.mockResolvedValue(mockCheckpointResponse);

    // Create checkpoint data
    const checkpointData: CheckpointDurableExecutionRequest = {
      CheckpointToken: "",
      Updates: [
        {
          Id: "step-id",
          SubType: OperationSubType.STEP,
          Type: OperationType.STEP,
          Action: OperationAction.START,
        },
      ],
    };

    // Call checkpoint
    const checkpointResult = await recordDefinitionStorage.checkpoint(
      "task-token",
      checkpointData,
    );

    // Setup mock response
    const mockGetStateResponse = { _stepData: [] };
    durableExecutionsClient.send.mockResolvedValue(mockGetStateResponse);

    // Call getStepData
    const getStepDataResult = await recordDefinitionStorage.getStepData(
      "task-token",
      "next-token",
    );

    const flowExecutionId = "my-flow-execution-id";

    const invocationEvent: DurableExecutionInvocationInput = {
      CheckpointToken: "",
      DurableExecutionArn: flowExecutionId,
      InitialExecutionState: {
        Operations: [],
        NextMarker: "",
      },
    };

    const response: DurableExecutionInvocationOutput = {
      Status: InvocationStatus.SUCCEEDED,
      Result: "",
    };

    recordDefinitionStorage.complete(invocationEvent, response);
    expect(log).toHaveBeenCalledWith(
      true,
      "📝",
      `Invocation definition for ${flowExecutionId}:`,
      {
        event: invocationEvent,
        response,
        checkpoints: [
          {
            input: {
              CheckpointToken: "task-token",
              Updates: checkpointData.Updates,
              ClientToken: checkpointData.ClientToken,
            },
            output: mockCheckpointResponse,
          },
        ],
        stepData: [
          {
            input: {
              CheckpointToken: "task-token",
              Marker: "next-token",
              MaxItems: 1000,
            },
            output: mockGetStateResponse,
          },
        ],
      },
    );
  });
});
