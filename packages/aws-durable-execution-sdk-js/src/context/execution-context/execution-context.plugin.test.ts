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

jest.mock("../../durable-execution-api-client/durable-execution-api-client");
jest.mock("../../utils/logger/logger");
jest.mock("../../termination-manager/termination-manager");
jest.mock("../../utils/logger/default-logger", () => ({
  createDefaultLogger: jest.fn().mockReturnValue({
    log: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    configureDurableLoggingContext: jest.fn(),
  }),
}));

describe("initializeExecutionContext - inter-invocation plugin dispatch", () => {
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

  let plugin: jest.Mocked<DurableInstrumentationPlugin>;

  beforeEach(() => {
    jest.clearAllMocks();
    (DurableExecutionApiClient as jest.Mock).mockImplementation(() => ({
      checkpoint: jest.fn(),
      getExecutionState: jest.fn(),
    }));
    plugin = {
      onOperationStart: jest.fn(),
      onOperationEnd: jest.fn(),
    };
  });

  function createEvent(
    operations: Operation[],
    updatedOperationIds?: string[],
  ): DurableExecutionInvocationInput {
    return {
      CheckpointToken: mockCheckpointToken,
      DurableExecutionArn: mockDurableExecutionArn,
      InitialExecutionState: {
        Operations: [mockExecutionEvent, ...operations],
        NextMarker: "",
      },
      updatedOperationIds,
    };
  }

  it("no hooks fire when updatedOperationIds is absent/undefined", async () => {
    const succeededOp: Operation = {
      Id: "op-1",
      Name: "completed-step",
      Type: OperationType.STEP,
      SubType: OperationSubType.STEP,
      Status: OperationStatus.SUCCEEDED,
      StartTimestamp: new Date(),
      EndTimestamp: new Date(),
    };

    const event = createEvent([succeededOp], undefined);

    await initializeExecutionContext(
      event,
      mockLambdaContext,
      undefined,
      plugin,
    );

    expect(plugin.onOperationStart).not.toHaveBeenCalled();
    expect(plugin.onOperationEnd).not.toHaveBeenCalled();
  });

  it("no hooks fire when updatedOperationIds is an empty array", async () => {
    const succeededOp: Operation = {
      Id: "op-1",
      Name: "completed-step",
      Type: OperationType.STEP,
      SubType: OperationSubType.STEP,
      Status: OperationStatus.SUCCEEDED,
      StartTimestamp: new Date(),
      EndTimestamp: new Date(),
    };

    const event = createEvent([succeededOp], []);

    await initializeExecutionContext(
      event,
      mockLambdaContext,
      undefined,
      plugin,
    );

    expect(plugin.onOperationStart).not.toHaveBeenCalled();
    expect(plugin.onOperationEnd).not.toHaveBeenCalled();
  });

  it("onOperationEnd fires for operations in updatedOperationIds with SUCCEEDED status", async () => {
    const succeededOp: Operation = {
      Id: "op-1",
      Name: "completed-step",
      Type: OperationType.STEP,
      SubType: OperationSubType.STEP,
      Status: OperationStatus.SUCCEEDED,
      StartTimestamp: new Date("2024-01-01T00:00:00Z"),
      EndTimestamp: new Date("2024-01-01T00:01:00Z"),
    };

    const event = createEvent([succeededOp], ["op-1"]);

    await initializeExecutionContext(
      event,
      mockLambdaContext,
      undefined,
      plugin,
    );

    expect(plugin.onOperationEnd).toHaveBeenCalledTimes(1);
    expect(plugin.onOperationEnd).toHaveBeenCalledWith({
      Id: "op-1",
      Name: "completed-step",
      Type: OperationType.STEP,
      SubType: OperationSubType.STEP,
      ParentId: undefined,
      StartTimestamp: succeededOp.StartTimestamp,
      EndTimestamp: succeededOp.EndTimestamp,
      error: undefined,
    });
    expect(plugin.onOperationStart).not.toHaveBeenCalled();
  });

  it("onOperationEnd fires for operations in updatedOperationIds with FAILED status", async () => {
    const failedOp: Operation = {
      Id: "op-2",
      Name: "failed-invoke",
      Type: OperationType.STEP,
      SubType: OperationSubType.CHAINED_INVOKE,
      Status: OperationStatus.FAILED,
      StartTimestamp: new Date("2024-01-01T00:00:00Z"),
      EndTimestamp: new Date("2024-01-01T00:02:00Z"),
      ChainedInvokeDetails: {
        Error: { ErrorMessage: "Invoke timed out" },
      },
    };

    const event = createEvent([failedOp], ["op-2"]);

    await initializeExecutionContext(
      event,
      mockLambdaContext,
      undefined,
      plugin,
    );

    expect(plugin.onOperationEnd).toHaveBeenCalledTimes(1);
    expect(plugin.onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        Id: "op-2",
        Name: "failed-invoke",
        error: expect.any(Error),
      }),
    );
    const endInfo = (plugin.onOperationEnd as jest.Mock).mock.calls[0][0];
    expect(endInfo.error.message).toBe("Invoke timed out");
  });

  it("onOperationEnd fires for other terminal statuses (TIMED_OUT, STOPPED, CANCELLED)", async () => {
    const timedOutOp: Operation = {
      Id: "op-timeout",
      Name: "timed-out-wait",
      Type: OperationType.STEP,
      SubType: OperationSubType.WAIT,
      Status: OperationStatus.TIMED_OUT,
      StartTimestamp: new Date(),
      EndTimestamp: new Date(),
    };

    const stoppedOp: Operation = {
      Id: "op-stopped",
      Name: "stopped-op",
      Type: OperationType.STEP,
      SubType: OperationSubType.STEP,
      Status: OperationStatus.STOPPED,
      StartTimestamp: new Date(),
      EndTimestamp: new Date(),
    };

    const cancelledOp: Operation = {
      Id: "op-cancelled",
      Name: "cancelled-op",
      Type: OperationType.STEP,
      SubType: OperationSubType.STEP,
      Status: OperationStatus.CANCELLED,
      StartTimestamp: new Date(),
      EndTimestamp: new Date(),
    };

    const event = createEvent(
      [timedOutOp, stoppedOp, cancelledOp],
      ["op-timeout", "op-stopped", "op-cancelled"],
    );

    await initializeExecutionContext(
      event,
      mockLambdaContext,
      undefined,
      plugin,
    );

    expect(plugin.onOperationEnd).toHaveBeenCalledTimes(3);
    expect(plugin.onOperationStart).not.toHaveBeenCalled();
  });

  it("onOperationStart fires for operations in updatedOperationIds with STARTED status", async () => {
    const startedOp: Operation = {
      Id: "op-3",
      Name: "started-step",
      Type: OperationType.STEP,
      SubType: OperationSubType.STEP,
      Status: OperationStatus.STARTED,
      StartTimestamp: new Date("2024-01-01T00:00:00Z"),
    };

    const event = createEvent([startedOp], ["op-3"]);

    await initializeExecutionContext(
      event,
      mockLambdaContext,
      undefined,
      plugin,
    );

    expect(plugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(plugin.onOperationStart).toHaveBeenCalledWith({
      Id: "op-3",
      Name: "started-step",
      Type: OperationType.STEP,
      SubType: OperationSubType.STEP,
      ParentId: undefined,
      StartTimestamp: startedOp.StartTimestamp,
      EndTimestamp: undefined,
    });
    expect(plugin.onOperationEnd).not.toHaveBeenCalled();
  });

  it("operations NOT in updatedOperationIds do NOT trigger hooks", async () => {
    const succeededOp: Operation = {
      Id: "op-included",
      Name: "included",
      Type: OperationType.STEP,
      SubType: OperationSubType.STEP,
      Status: OperationStatus.SUCCEEDED,
      StartTimestamp: new Date(),
      EndTimestamp: new Date(),
    };

    const anotherSucceededOp: Operation = {
      Id: "op-excluded",
      Name: "excluded",
      Type: OperationType.STEP,
      SubType: OperationSubType.STEP,
      Status: OperationStatus.SUCCEEDED,
      StartTimestamp: new Date(),
      EndTimestamp: new Date(),
    };

    // Only op-included is in updatedOperationIds
    const event = createEvent(
      [succeededOp, anotherSucceededOp],
      ["op-included"],
    );

    await initializeExecutionContext(
      event,
      mockLambdaContext,
      undefined,
      plugin,
    );

    expect(plugin.onOperationEnd).toHaveBeenCalledTimes(1);
    expect(plugin.onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({ Id: "op-included" }),
    );
  });

  it("operations in updatedOperationIds that don't exist in stepData are skipped without error", async () => {
    const existingOp: Operation = {
      Id: "op-exists",
      Name: "existing",
      Type: OperationType.STEP,
      SubType: OperationSubType.STEP,
      Status: OperationStatus.SUCCEEDED,
      StartTimestamp: new Date(),
      EndTimestamp: new Date(),
    };

    // "op-missing" is listed in updatedOperationIds but not in operations
    const event = createEvent([existingOp], ["op-exists", "op-missing"]);

    await initializeExecutionContext(
      event,
      mockLambdaContext,
      undefined,
      plugin,
    );

    // Only the existing operation fires a hook
    expect(plugin.onOperationEnd).toHaveBeenCalledTimes(1);
    expect(plugin.onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({ Id: "op-exists" }),
    );
  });

  it("operations in updatedOperationIds with PENDING status are skipped", async () => {
    const pendingOp: Operation = {
      Id: "op-pending",
      Name: "pending-step",
      Type: OperationType.STEP,
      SubType: OperationSubType.STEP,
      Status: OperationStatus.PENDING,
      StartTimestamp: new Date(),
    };

    const event = createEvent([pendingOp], ["op-pending"]);

    await initializeExecutionContext(
      event,
      mockLambdaContext,
      undefined,
      plugin,
    );

    expect(plugin.onOperationStart).not.toHaveBeenCalled();
    expect(plugin.onOperationEnd).not.toHaveBeenCalled();
  });

  it("no hooks fire when plugin is not provided", async () => {
    const succeededOp: Operation = {
      Id: "op-1",
      Name: "completed-step",
      Type: OperationType.STEP,
      SubType: OperationSubType.STEP,
      Status: OperationStatus.SUCCEEDED,
      StartTimestamp: new Date(),
      EndTimestamp: new Date(),
    };

    const event = createEvent([succeededOp], ["op-1"]);

    // Should not throw even without a plugin
    await expect(
      initializeExecutionContext(
        event,
        mockLambdaContext,
        undefined,
        undefined,
      ),
    ).resolves.toBeDefined();
  });

  it("dispatches correct mix of onOperationStart and onOperationEnd for multiple operations", async () => {
    const startedOp: Operation = {
      Id: "op-started",
      Name: "starting",
      Type: OperationType.STEP,
      SubType: OperationSubType.STEP,
      Status: OperationStatus.STARTED,
      StartTimestamp: new Date(),
    };

    const succeededOp: Operation = {
      Id: "op-succeeded",
      Name: "done",
      Type: OperationType.STEP,
      SubType: OperationSubType.CHAINED_INVOKE,
      Status: OperationStatus.SUCCEEDED,
      StartTimestamp: new Date(),
      EndTimestamp: new Date(),
    };

    const failedOp: Operation = {
      Id: "op-failed",
      Name: "errored",
      Type: OperationType.STEP,
      SubType: OperationSubType.CALLBACK,
      Status: OperationStatus.FAILED,
      StartTimestamp: new Date(),
      EndTimestamp: new Date(),
      CallbackDetails: {
        Error: { ErrorMessage: "Callback failed" },
      },
    };

    const event = createEvent(
      [startedOp, succeededOp, failedOp],
      ["op-started", "op-succeeded", "op-failed"],
    );

    await initializeExecutionContext(
      event,
      mockLambdaContext,
      undefined,
      plugin,
    );

    expect(plugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(plugin.onOperationStart).toHaveBeenCalledWith(
      expect.objectContaining({ Id: "op-started" }),
    );

    expect(plugin.onOperationEnd).toHaveBeenCalledTimes(2);
    expect(plugin.onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({ Id: "op-succeeded", error: undefined }),
    );
    expect(plugin.onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        Id: "op-failed",
        error: expect.objectContaining({ message: "Callback failed" }),
      }),
    );
  });

  it("populates error from StepDetails when operation is a failed step", async () => {
    const failedStep: Operation = {
      Id: "op-step-fail",
      Name: "step-with-error",
      Type: OperationType.STEP,
      SubType: OperationSubType.STEP,
      Status: OperationStatus.FAILED,
      StartTimestamp: new Date(),
      EndTimestamp: new Date(),
      StepDetails: {
        Error: { ErrorMessage: "Step execution failed" },
      },
    };

    const event = createEvent([failedStep], ["op-step-fail"]);

    await initializeExecutionContext(
      event,
      mockLambdaContext,
      undefined,
      plugin,
    );

    expect(plugin.onOperationEnd).toHaveBeenCalledTimes(1);
    const endInfo = (plugin.onOperationEnd as jest.Mock).mock.calls[0][0];
    expect(endInfo.error).toBeInstanceOf(Error);
    expect(endInfo.error.message).toBe("Step execution failed");
  });

  it("includes ParentId in hook info when operation has a parent", async () => {
    const childOp: Operation = {
      Id: "child-op",
      Name: "child-step",
      Type: OperationType.STEP,
      SubType: OperationSubType.STEP,
      ParentId: "parent-context-id",
      Status: OperationStatus.SUCCEEDED,
      StartTimestamp: new Date(),
      EndTimestamp: new Date(),
    };

    const event = createEvent([childOp], ["child-op"]);

    await initializeExecutionContext(
      event,
      mockLambdaContext,
      undefined,
      plugin,
    );

    expect(plugin.onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        Id: "child-op",
        ParentId: "parent-context-id",
      }),
    );
  });
});
