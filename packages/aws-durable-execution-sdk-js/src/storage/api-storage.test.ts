import {
  CheckpointDurableExecutionCommand,
  CheckpointDurableExecutionRequest,
  LambdaClient,
  GetDurableExecutionStateCommand,
  OperationAction,
  OperationType,
} from "@aws-sdk/client-lambda";
import { OperationSubType } from "../types";
import { ApiStorage } from "./api-storage";

// Mock the LambdaClient
jest.mock("@aws-sdk/client-lambda", () => {
  const originalModule = jest.requireActual("@aws-sdk/client-lambda");
  return {
    ...originalModule,
    LambdaClient: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
    CheckpointDurableExecutionCommand: jest.fn(),
    GetDurableExecutionStateCommand: jest.fn(),
  };
});

describe("ApiStorage", () => {
  let apiStorage: ApiStorage;
  let mockLambdaClient: { send: jest.Mock };

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create a new instance of ApiStorage
    apiStorage = new ApiStorage();

    // Get the mocked LambdaClient instance
    mockLambdaClient = (LambdaClient as jest.Mock).mock.results[0].value;
  });

  test("should initialize with correct endpoint and region", () => {
    // Verify that LambdaClient was constructed with the correct parameters
    expect(LambdaClient).toHaveBeenCalledWith();
  });

  test("should call getStepData with correct parameters", async () => {
    // Setup mock response
    const mockResponse = { _stepData: [] };
    mockLambdaClient.send.mockResolvedValue(mockResponse);

    // Call getStepData
    const result = await apiStorage.getStepData(
      "checkpoint-token",
      "durable-execution-arn",
      "next-marker",
    );

    // Verify that GetDurableExecutionStateCommand was constructed with the correct parameters
    expect(GetDurableExecutionStateCommand).toHaveBeenCalledWith({
      DurableExecutionArn: "durable-execution-arn",
      CheckpointToken: "checkpoint-token",
      Marker: "next-marker",
      MaxItems: 1000,
    });

    // Verify that send was called with the GetDurableExecutionStateCommand
    expect(mockLambdaClient.send).toHaveBeenCalledWith(
      expect.any(GetDurableExecutionStateCommand),
    );

    // Verify the result
    expect(result).toBe(mockResponse);
  });

  test("should call checkpoint with correct parameters", async () => {
    // Setup mock response
    const mockResponse = { taskToken: "new-task-token" };
    mockLambdaClient.send.mockResolvedValue(mockResponse);

    // Create checkpoint data
    const checkpointData: CheckpointDurableExecutionRequest = {
      DurableExecutionArn: "test-durable-execution-arn",
      CheckpointToken: "",
      Updates: [
        {
          Id: "test-step-1",
          SubType: OperationSubType.STEP,
          Type: OperationType.STEP,
          Action: OperationAction.START,
        },
      ],
    };

    // Call checkpoint
    const result = await apiStorage.checkpoint("task-token", checkpointData);

    // Verify that CheckpointDurableExecutionCommand was constructed with the correct parameters
    expect(CheckpointDurableExecutionCommand).toHaveBeenCalledWith({
      DurableExecutionArn: "test-durable-execution-arn",
      CheckpointToken: "task-token",
      Updates: checkpointData.Updates,
    });

    // Verify that send was called with the CheckpointDurableExecutionCommand
    expect(mockLambdaClient.send).toHaveBeenCalledWith(
      expect.any(CheckpointDurableExecutionCommand),
    );

    // Verify the result
    expect(result).toBe(mockResponse);
  });

  test("should propagate errors from LambdaClient", async () => {
    // Setup mock error
    const mockError = new Error("Lambda client error");
    mockLambdaClient.send.mockRejectedValue(mockError);

    // Call getStepData and expect it to throw
    await expect(
      apiStorage.getStepData(
        "task-token",
        "durable-execution-arn",
        "next-token",
      ),
    ).rejects.toThrow("Lambda client error");

    // Call checkpoint and expect it to throw
    await expect(
      apiStorage.checkpoint("task-token", {
        DurableExecutionArn: "",
        CheckpointToken: "",
        Updates: [
          {
            Id: "test-step-2",
            SubType: OperationSubType.STEP,
            Type: OperationType.STEP,
            Action: OperationAction.START,
          },
        ],
      }),
    ).rejects.toThrow("Lambda client error");
  });
});
