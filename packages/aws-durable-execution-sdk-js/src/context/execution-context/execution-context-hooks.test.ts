import {
  Operation,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { DurableExecutionInvocationInput, OperationSubType } from "../../types";
import { DurableInstrumentationPlugin } from "../../types/plugin";
import { initializeExecutionContext } from "./execution-context";
import { Context } from "aws-lambda";
import { DurableExecutionApiClient } from "../../durable-execution-api-client/durable-execution-api-client";
import { createDefaultLogger } from "../../utils/logger/default-logger";

// Mock dependencies
jest.mock("../../durable-execution-api-client/durable-execution-api-client");
jest.mock("../../utils/logger/logger");
jest.mock("../../termination-manager/termination-manager");
jest.mock("../../utils/logger/default-logger");

describe("initializeExecutionContext - inter-invocation hook dispatch", () => {
  const mockCheckpointToken = "test-checkpoint-token";
  const mockDurableExecutionArn = "test-durable-execution-arn";

  const mockExecutionEvent: Operation = {
    Id: "",
    ParentId: undefined,
    Name: "",
    Type: OperationType.EXECUTION,
    StartTimestamp: new Date(),
    Status: "STARTED",
    ExecutionDetails: {
      InputPayload: '{"hello": "world"}',
    },
  };

  const mockLambdaContext: Context = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: "test-function",
    functionVersion: "1",
    invokedFunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:test",
    memoryLimitInMB: "128",
    awsRequestId: "test-request-id",
    logGroupName: "/aws/lambda/test",
    logStreamName: "test-stream",
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  };

  let mockPlugin: jest.Mocked<
    Required<
      Pick<DurableInstrumentationPlugin, "onOperationEnd" | "onOperationStart">
    >
  >;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPlugin = {
      onOperationEnd: jest.fn(),
      onOperationStart: jest.fn(),
    };

    (DurableExecutionApiClient as jest.Mock).mockImplementation(() => ({
      checkpoint: jest.fn(),
      getExecutionState: jest.fn(),
    }));

    (createDefaultLogger as jest.Mock).mockReturnValue({
      log: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      configureDurableLoggingContext: jest.fn(),
    });

    process.env.DURABLE_VERBOSE_MODE = "false";
  });

  afterEach(() => {
    delete process.env.DURABLE_VERBOSE_MODE;
  });

  it("should not fire any hooks when updatedOperationIds is absent", async () => {
    const event: DurableExecutionInvocationInput = {
      CheckpointToken: mockCheckpointToken,
      DurableExecutionArn: mockDurableExecutionArn,
      InitialExecutionState: {
        Operations: [
          mockExecutionEvent,
          {
            Id: "op1",
            Status: OperationStatus.SUCCEEDED,
            Type: OperationType.STEP,
            SubType: OperationSubType.STEP,
            StartTimestamp: new Date(),
          },
        ],
        NextMarker: "",
      },
      // updatedOperationIds is absent (undefined)
    };

    await initializeExecutionContext(
      event,
      mockLambdaContext,
      undefined,
      mockPlugin,
    );

    expect(mockPlugin.onOperationEnd).not.toHaveBeenCalled();
    expect(mockPlugin.onOperationStart).not.toHaveBeenCalled();
  });

  it("should not fire any hooks when updatedOperationIds is an empty array", async () => {
    const event: DurableExecutionInvocationInput = {
      CheckpointToken: mockCheckpointToken,
      DurableExecutionArn: mockDurableExecutionArn,
      InitialExecutionState: {
        Operations: [
          mockExecutionEvent,
          {
            Id: "op1",
            Status: OperationStatus.SUCCEEDED,
            Type: OperationType.STEP,
            SubType: OperationSubType.STEP,
            StartTimestamp: new Date(),
          },
        ],
        NextMarker: "",
      },
      updatedOperationIds: [],
    };

    await initializeExecutionContext(
      event,
      mockLambdaContext,
      undefined,
      mockPlugin,
    );

    expect(mockPlugin.onOperationEnd).not.toHaveBeenCalled();
    expect(mockPlugin.onOperationStart).not.toHaveBeenCalled();
  });

  it("should fire onOperationEnd for an operation with SUCCEEDED status in updatedOperationIds", async () => {
    const succeededOp: Operation = {
      Id: "op-succeeded",
      Name: "my-step",
      Status: OperationStatus.SUCCEEDED,
      Type: OperationType.STEP,
      SubType: OperationSubType.STEP,
      StartTimestamp: new Date("2024-01-01T00:00:00Z"),
      EndTimestamp: new Date("2024-01-01T00:01:00Z"),
    };

    const event: DurableExecutionInvocationInput = {
      CheckpointToken: mockCheckpointToken,
      DurableExecutionArn: mockDurableExecutionArn,
      InitialExecutionState: {
        Operations: [mockExecutionEvent, succeededOp],
        NextMarker: "",
      },
      updatedOperationIds: ["op-succeeded"],
    };

    await initializeExecutionContext(
      event,
      mockLambdaContext,
      undefined,
      mockPlugin,
    );

    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        Id: "op-succeeded",
        Name: "my-step",
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
        error: undefined,
      }),
    );
    expect(mockPlugin.onOperationStart).not.toHaveBeenCalled();
  });

  it("should fire onOperationEnd for an operation with FAILED status and include the error", async () => {
    const failedOp: Operation = {
      Id: "op-failed",
      Name: "my-failing-step",
      Status: OperationStatus.FAILED,
      Type: OperationType.STEP,
      SubType: OperationSubType.STEP,
      StartTimestamp: new Date("2024-01-01T00:00:00Z"),
      EndTimestamp: new Date("2024-01-01T00:01:00Z"),
      StepDetails: {
        Error: {
          ErrorMessage: "Something went wrong",
        },
      },
    };

    const event: DurableExecutionInvocationInput = {
      CheckpointToken: mockCheckpointToken,
      DurableExecutionArn: mockDurableExecutionArn,
      InitialExecutionState: {
        Operations: [mockExecutionEvent, failedOp],
        NextMarker: "",
      },
      updatedOperationIds: ["op-failed"],
    };

    await initializeExecutionContext(
      event,
      mockLambdaContext,
      undefined,
      mockPlugin,
    );

    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        Id: "op-failed",
        Name: "my-failing-step",
        Type: OperationType.STEP,
        error: expect.objectContaining({
          message: "Something went wrong",
        }),
      }),
    );
    expect(mockPlugin.onOperationStart).not.toHaveBeenCalled();
  });

  it("should fire onOperationStart for an operation with STARTED status in updatedOperationIds", async () => {
    const startedOp: Operation = {
      Id: "op-started",
      Name: "my-invoke",
      Status: OperationStatus.STARTED,
      Type: OperationType.STEP,
      SubType: OperationSubType.CHAINED_INVOKE,
      StartTimestamp: new Date("2024-01-01T00:00:00Z"),
    };

    const event: DurableExecutionInvocationInput = {
      CheckpointToken: mockCheckpointToken,
      DurableExecutionArn: mockDurableExecutionArn,
      InitialExecutionState: {
        Operations: [mockExecutionEvent, startedOp],
        NextMarker: "",
      },
      updatedOperationIds: ["op-started"],
    };

    await initializeExecutionContext(
      event,
      mockLambdaContext,
      undefined,
      mockPlugin,
    );

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationStart).toHaveBeenCalledWith(
      expect.objectContaining({
        Id: "op-started",
        Name: "my-invoke",
        Type: OperationType.STEP,
        SubType: OperationSubType.CHAINED_INVOKE,
      }),
    );
    expect(mockPlugin.onOperationEnd).not.toHaveBeenCalled();
  });

  it("should not fire hooks for IDs in updatedOperationIds that do not exist in stepData", async () => {
    const event: DurableExecutionInvocationInput = {
      CheckpointToken: mockCheckpointToken,
      DurableExecutionArn: mockDurableExecutionArn,
      InitialExecutionState: {
        Operations: [mockExecutionEvent],
        NextMarker: "",
      },
      updatedOperationIds: ["nonexistent-op-id"],
    };

    await initializeExecutionContext(
      event,
      mockLambdaContext,
      undefined,
      mockPlugin,
    );

    expect(mockPlugin.onOperationEnd).not.toHaveBeenCalled();
    expect(mockPlugin.onOperationStart).not.toHaveBeenCalled();
  });

  it("should not fire hooks for IDs in updatedOperationIds with PENDING status", async () => {
    const pendingOp: Operation = {
      Id: "op-pending",
      Name: "my-pending-step",
      Status: OperationStatus.PENDING,
      Type: OperationType.STEP,
      SubType: OperationSubType.STEP,
      StartTimestamp: new Date("2024-01-01T00:00:00Z"),
    };

    const event: DurableExecutionInvocationInput = {
      CheckpointToken: mockCheckpointToken,
      DurableExecutionArn: mockDurableExecutionArn,
      InitialExecutionState: {
        Operations: [mockExecutionEvent, pendingOp],
        NextMarker: "",
      },
      updatedOperationIds: ["op-pending"],
    };

    await initializeExecutionContext(
      event,
      mockLambdaContext,
      undefined,
      mockPlugin,
    );

    expect(mockPlugin.onOperationEnd).not.toHaveBeenCalled();
    expect(mockPlugin.onOperationStart).not.toHaveBeenCalled();
  });
});
