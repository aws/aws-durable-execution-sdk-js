import {
  OperationAction,
  OperationStatus,
  OperationType,
  Operation,
} from "@aws-sdk/client-lambda";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { OperationSubType, ExecutionContext, DurableLogger } from "../../types";
import { TEST_CONSTANTS } from "../../testing/test-constants";
import { CheckpointManager } from "./checkpoint-manager";
import { hashId, getStepData } from "../step-id-utils/step-id-utils";
import { EventEmitter } from "events";
import { createDefaultLogger } from "../logger/default-logger";
import { DurableExecutionClient } from "../../types/durable-execution";
import {
  DurableInstrumentationPlugin,
  OperationEndInfo,
} from "../../types/plugin";
import { createPluginRunner } from "../plugin/plugin-runner";

// Mock dependencies
jest.mock("../../utils/logger/logger", () => ({
  log: jest.fn(),
}));

describe("CheckpointManager - Hook Dispatch (state transition detection)", () => {
  let mockTerminationManager: TerminationManager;
  let mockState: jest.Mocked<DurableExecutionClient>;
  let mockContext: ExecutionContext;
  let mockEmitter: EventEmitter;
  let mockLogger: DurableLogger;
  let mockPlugin: {
    onOperationStart: jest.Mock;
    onOperationEnd: jest.Mock;
    onOperationChange: jest.Mock;
  };

  const mockNewTaskToken = "new-task-token";

  function createCheckpointManagerWithPlugin(
    plugin: DurableInstrumentationPlugin,
    stepData: Record<string, Operation> = {},
  ): CheckpointManager {
    return new CheckpointManager(
      mockContext.durableExecutionArn,
      stepData,
      mockContext.durableExecutionClient,
      mockContext.terminationManager,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
      new Set<string>(),
      plugin,
      "test-request-id",
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmitter = new EventEmitter();

    mockTerminationManager = new TerminationManager();
    jest.spyOn(mockTerminationManager, "terminate");

    mockPlugin = {
      onOperationStart: jest.fn(),
      onOperationEnd: jest.fn(),
      onOperationChange: jest.fn(),
    };

    mockState = {
      getExecutionState: jest.fn(),
      checkpoint: jest.fn().mockResolvedValue({
        CheckpointToken: mockNewTaskToken,
      }),
    };

    const stepData: Record<string, Operation> = {};
    mockContext = {
      durableExecutionArn: "test-durable-execution-arn",
      durableExecutionClient: mockState,
      _stepData: stepData,
      terminationManager: mockTerminationManager,
      pendingCompletions: new Set<string>(),
      getStepData: jest.fn((stepId: string) => {
        return getStepData(stepData, stepId);
      }),
      requestId: "test-request-id",
      tenantId: undefined,
    } satisfies ExecutionContext;
    mockLogger = createDefaultLogger(mockContext);
  });

  describe("onOperationStart fires for new STARTED operations", () => {
    it("should call onOperationStart when a new operation with STARTED status appears in the checkpoint response", async () => {
      const stepId = "step-1";
      const hashedId = hashId(stepId);

      // Checkpoint response returns an operation that was not in previous stepData
      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
        NewExecutionState: {
          Operations: [
            {
              Id: hashedId,
              Name: "my-step",
              Type: OperationType.STEP,
              SubType: OperationSubType.STEP,
              Status: OperationStatus.STARTED,
              StartTimestamp: new Date("2024-01-01T00:00:00Z"),
            },
          ],
        },
      });

      const checkpointManager = createCheckpointManagerWithPlugin(mockPlugin);

      await checkpointManager.checkpoint(stepId, {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        Name: "my-step",
      });

      expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
      expect(mockPlugin.onOperationStart).toHaveBeenCalledWith(
        expect.objectContaining({
          Id: hashedId,
          Name: "my-step",
          Type: OperationType.STEP,
          SubType: OperationSubType.STEP,
          StartTimestamp: new Date("2024-01-01T00:00:00Z"),
        }),
      );
    });

    it("should NOT call onOperationStart when the operation already existed in stepData", async () => {
      const stepId = "step-1";
      const hashedId = hashId(stepId);

      // Pre-populate stepData with an existing operation
      const existingStepData: Record<string, Operation> = {
        [hashedId]: {
          Id: hashedId,
          Name: "my-step",
          Type: OperationType.STEP,
          SubType: OperationSubType.STEP,
          Status: OperationStatus.STARTED,
          StartTimestamp: new Date("2024-01-01T00:00:00Z"),
        },
      };

      // Checkpoint response returns the same operation with unchanged STARTED status
      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
        NewExecutionState: {
          Operations: [
            {
              Id: hashedId,
              Name: "my-step",
              Type: OperationType.STEP,
              SubType: OperationSubType.STEP,
              Status: OperationStatus.STARTED,
              StartTimestamp: new Date("2024-01-01T00:00:00Z"),
            },
          ],
        },
      });

      const checkpointManager = createCheckpointManagerWithPlugin(
        mockPlugin,
        existingStepData,
      );

      await checkpointManager.checkpoint(stepId, {
        Action: OperationAction.SUCCEED,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      expect(mockPlugin.onOperationStart).not.toHaveBeenCalled();
    });

    it("should NOT call onOperationStart when a new operation has a non-STARTED status", async () => {
      const stepId = "step-1";
      const hashedId = hashId(stepId);

      // Checkpoint response returns a new operation that immediately has SUCCEEDED status
      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
        NewExecutionState: {
          Operations: [
            {
              Id: hashedId,
              Name: "my-step",
              Type: OperationType.STEP,
              SubType: OperationSubType.STEP,
              Status: OperationStatus.SUCCEEDED,
              StartTimestamp: new Date("2024-01-01T00:00:00Z"),
            },
          ],
        },
      });

      const checkpointManager = createCheckpointManagerWithPlugin(mockPlugin);

      await checkpointManager.checkpoint(stepId, {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      // onOperationStart should NOT fire since the status is not STARTED
      expect(mockPlugin.onOperationStart).not.toHaveBeenCalled();
      // But onOperationEnd should fire since it went from no-prior-state to terminal
      expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe("onOperationEnd fires for terminal transitions", () => {
    it("should call onOperationEnd when operation transitions from STARTED to SUCCEEDED", async () => {
      const stepId = "step-1";
      const hashedId = hashId(stepId);

      // Pre-populate stepData with a STARTED operation
      const existingStepData: Record<string, Operation> = {
        [hashedId]: {
          Id: hashedId,
          Name: "my-step",
          Type: OperationType.STEP,
          SubType: OperationSubType.STEP,
          Status: OperationStatus.STARTED,
          StartTimestamp: new Date("2024-01-01T00:00:00Z"),
        },
      };

      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
        NewExecutionState: {
          Operations: [
            {
              Id: hashedId,
              Name: "my-step",
              Type: OperationType.STEP,
              SubType: OperationSubType.STEP,
              Status: OperationStatus.SUCCEEDED,
              StartTimestamp: new Date("2024-01-01T00:00:00Z"),
              EndTimestamp: new Date("2024-01-01T00:01:00Z"),
            },
          ],
        },
      });

      const checkpointManager = createCheckpointManagerWithPlugin(
        mockPlugin,
        existingStepData,
      );

      await checkpointManager.checkpoint(stepId, {
        Action: OperationAction.SUCCEED,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
      expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          Id: hashedId,
          Name: "my-step",
          Type: OperationType.STEP,
          SubType: OperationSubType.STEP,
          EndTimestamp: new Date("2024-01-01T00:01:00Z"),
          error: undefined,
        }),
      );
    });

    it("should call onOperationEnd with error when operation transitions from STARTED to FAILED", async () => {
      const stepId = "step-1";
      const hashedId = hashId(stepId);

      const existingStepData: Record<string, Operation> = {
        [hashedId]: {
          Id: hashedId,
          Name: "my-step",
          Type: OperationType.STEP,
          SubType: OperationSubType.STEP,
          Status: OperationStatus.STARTED,
          StartTimestamp: new Date("2024-01-01T00:00:00Z"),
        },
      };

      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
        NewExecutionState: {
          Operations: [
            {
              Id: hashedId,
              Name: "my-step",
              Type: OperationType.STEP,
              SubType: OperationSubType.STEP,
              Status: OperationStatus.FAILED,
              StartTimestamp: new Date("2024-01-01T00:00:00Z"),
              EndTimestamp: new Date("2024-01-01T00:01:00Z"),
              StepDetails: {
                Error: {
                  ErrorMessage: "Something went wrong",
                  ErrorType: "RuntimeError",
                },
              },
            },
          ],
        },
      });

      const checkpointManager = createCheckpointManagerWithPlugin(
        mockPlugin,
        existingStepData,
      );

      await checkpointManager.checkpoint(stepId, {
        Action: OperationAction.FAIL,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
      const endCall = mockPlugin.onOperationEnd.mock
        .calls[0][0] as OperationEndInfo;
      expect(endCall.Id).toBe(hashedId);
      expect(endCall.error).toBeInstanceOf(Error);
      expect(endCall.error?.message).toBe("Something went wrong");
    });

    it("should call onOperationEnd when operation transitions to TIMED_OUT", async () => {
      const stepId = "wait-1";
      const hashedId = hashId(stepId);

      const existingStepData: Record<string, Operation> = {
        [hashedId]: {
          Id: hashedId,
          Name: "my-wait",
          Type: OperationType.WAIT,
          SubType: OperationSubType.WAIT,
          Status: OperationStatus.STARTED,
          StartTimestamp: new Date("2024-01-01T00:00:00Z"),
        },
      };

      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
        NewExecutionState: {
          Operations: [
            {
              Id: hashedId,
              Name: "my-wait",
              Type: OperationType.WAIT,
              SubType: OperationSubType.WAIT,
              Status: OperationStatus.TIMED_OUT,
              StartTimestamp: new Date("2024-01-01T00:00:00Z"),
            },
          ],
        },
      });

      const checkpointManager = createCheckpointManagerWithPlugin(
        mockPlugin,
        existingStepData,
      );

      await checkpointManager.checkpoint(stepId, {
        Action: OperationAction.SUCCEED,
        SubType: OperationSubType.WAIT,
        Type: OperationType.WAIT,
      });

      expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
      expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          Id: hashedId,
          Name: "my-wait",
          Type: OperationType.WAIT,
        }),
      );
    });

    it("should call onOperationEnd when operation transitions from no prior state to terminal status", async () => {
      const stepId = "step-1";
      const hashedId = hashId(stepId);

      // No previous stepData — a brand-new operation that immediately shows as SUCCEEDED
      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
        NewExecutionState: {
          Operations: [
            {
              Id: hashedId,
              Name: "fast-step",
              Type: OperationType.STEP,
              SubType: OperationSubType.STEP,
              Status: OperationStatus.SUCCEEDED,
              StartTimestamp: new Date("2024-01-01T00:00:00Z"),
            },
          ],
        },
      });

      const checkpointManager = createCheckpointManagerWithPlugin(mockPlugin);

      await checkpointManager.checkpoint(stepId, {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
      expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          Id: hashedId,
          Name: "fast-step",
        }),
      );
    });
  });

  describe("hooks do NOT fire when status has not changed", () => {
    it("should NOT fire any hooks when checkpoint response echoes back the same status", async () => {
      const stepId = "step-1";
      const hashedId = hashId(stepId);

      // stepData already has a SUCCEEDED operation
      const existingStepData: Record<string, Operation> = {
        [hashedId]: {
          Id: hashedId,
          Name: "my-step",
          Type: OperationType.STEP,
          SubType: OperationSubType.STEP,
          Status: OperationStatus.SUCCEEDED,
          StartTimestamp: new Date("2024-01-01T00:00:00Z"),
        },
      };

      // Checkpoint response echoes back the same SUCCEEDED status
      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
        NewExecutionState: {
          Operations: [
            {
              Id: hashedId,
              Name: "my-step",
              Type: OperationType.STEP,
              SubType: OperationSubType.STEP,
              Status: OperationStatus.SUCCEEDED,
              StartTimestamp: new Date("2024-01-01T00:00:00Z"),
            },
          ],
        },
      });

      const checkpointManager = createCheckpointManagerWithPlugin(
        mockPlugin,
        existingStepData,
      );

      await checkpointManager.checkpoint(stepId, {
        Action: OperationAction.SUCCEED,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      expect(mockPlugin.onOperationStart).not.toHaveBeenCalled();
      expect(mockPlugin.onOperationEnd).not.toHaveBeenCalled();
    });

    it("should NOT fire onOperationEnd when transitioning between non-terminal statuses", async () => {
      const stepId = "step-1";
      const hashedId = hashId(stepId);

      // stepData has a PENDING operation (from retry)
      const existingStepData: Record<string, Operation> = {
        [hashedId]: {
          Id: hashedId,
          Name: "my-step",
          Type: OperationType.STEP,
          SubType: OperationSubType.STEP,
          Status: OperationStatus.PENDING,
          StartTimestamp: new Date("2024-01-01T00:00:00Z"),
        },
      };

      // Checkpoint response shows transition from PENDING to STARTED
      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
        NewExecutionState: {
          Operations: [
            {
              Id: hashedId,
              Name: "my-step",
              Type: OperationType.STEP,
              SubType: OperationSubType.STEP,
              Status: OperationStatus.STARTED,
              StartTimestamp: new Date("2024-01-01T00:00:00Z"),
            },
          ],
        },
      });

      const checkpointManager = createCheckpointManagerWithPlugin(
        mockPlugin,
        existingStepData,
      );

      await checkpointManager.checkpoint(stepId, {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      // onOperationEnd should NOT fire since STARTED is not a terminal status
      expect(mockPlugin.onOperationEnd).not.toHaveBeenCalled();
      // onOperationStart should also NOT fire since the operation already existed
      expect(mockPlugin.onOperationStart).not.toHaveBeenCalled();
    });

    it("should NOT fire hooks when checkpoint response has no Operations", async () => {
      const stepId = "step-1";

      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
        NewExecutionState: undefined,
      });

      const checkpointManager = createCheckpointManagerWithPlugin(mockPlugin);

      await checkpointManager.checkpoint(stepId, {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      expect(mockPlugin.onOperationStart).not.toHaveBeenCalled();
      expect(mockPlugin.onOperationEnd).not.toHaveBeenCalled();
    });
  });

  describe("OperationInfo fields are correctly populated", () => {
    it("should populate all OperationInfo fields from the checkpoint response operation", async () => {
      const stepId = "1-2";
      const hashedId = hashId(stepId);
      const parentId = "1";
      const hashedParentId = hashId(parentId);
      const startTimestamp = new Date("2024-01-01T00:00:00Z");

      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
        NewExecutionState: {
          Operations: [
            {
              Id: hashedId,
              Name: "child-step",
              Type: OperationType.STEP,
              SubType: OperationSubType.STEP,
              ParentId: hashedParentId,
              Status: OperationStatus.STARTED,
              StartTimestamp: startTimestamp,
            },
          ],
        },
      });

      const checkpointManager = createCheckpointManagerWithPlugin(mockPlugin);

      await checkpointManager.checkpoint(stepId, {
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        ParentId: parentId,
        Name: "child-step",
      });

      expect(mockPlugin.onOperationStart).toHaveBeenCalledWith({
        Id: hashedId,
        Name: "child-step",
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
        ParentId: hashedParentId,
        StartTimestamp: startTimestamp,
        EndTimestamp: undefined,
      });
    });

    it("should populate EndTimestamp in OperationEndInfo from the checkpoint response", async () => {
      const stepId = "step-1";
      const hashedId = hashId(stepId);
      const startTimestamp = new Date("2024-01-01T00:00:00Z");
      const endTimestamp = new Date("2024-01-01T00:01:00Z");

      const existingStepData: Record<string, Operation> = {
        [hashedId]: {
          Id: hashedId,
          Name: "my-step",
          Type: OperationType.STEP,
          SubType: OperationSubType.STEP,
          Status: OperationStatus.STARTED,
          StartTimestamp: startTimestamp,
        },
      };

      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
        NewExecutionState: {
          Operations: [
            {
              Id: hashedId,
              Name: "my-step",
              Type: OperationType.STEP,
              SubType: OperationSubType.STEP,
              Status: OperationStatus.SUCCEEDED,
              StartTimestamp: startTimestamp,
              EndTimestamp: endTimestamp,
            },
          ],
        },
      });

      const checkpointManager = createCheckpointManagerWithPlugin(
        mockPlugin,
        existingStepData,
      );

      await checkpointManager.checkpoint(stepId, {
        Action: OperationAction.SUCCEED,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith({
        Id: hashedId,
        Name: "my-step",
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
        ParentId: undefined,
        StartTimestamp: startTimestamp,
        EndTimestamp: endTimestamp,
        error: undefined,
      });
    });

    it("should extract error from ChainedInvokeDetails for FAILED invoke operations", async () => {
      const stepId = "invoke-1";
      const hashedId = hashId(stepId);

      const existingStepData: Record<string, Operation> = {
        [hashedId]: {
          Id: hashedId,
          Name: "my-invoke",
          Type: OperationType.CHAINED_INVOKE,
          SubType: "ChainedInvoke",
          Status: OperationStatus.STARTED,
          StartTimestamp: new Date("2024-01-01T00:00:00Z"),
        },
      };

      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
        NewExecutionState: {
          Operations: [
            {
              Id: hashedId,
              Name: "my-invoke",
              Type: OperationType.CHAINED_INVOKE,
              SubType: "ChainedInvoke",
              Status: OperationStatus.FAILED,
              StartTimestamp: new Date("2024-01-01T00:00:00Z"),
              ChainedInvokeDetails: {
                Error: {
                  ErrorMessage: "Invoke target failed",
                  ErrorType: "InvokeError",
                },
              },
            },
          ],
        },
      });

      const checkpointManager = createCheckpointManagerWithPlugin(
        mockPlugin,
        existingStepData,
      );

      await checkpointManager.checkpoint(stepId, {
        Action: OperationAction.FAIL,
        SubType: "ChainedInvoke",
        Type: OperationType.CHAINED_INVOKE,
      });

      expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
      const endCall = mockPlugin.onOperationEnd.mock
        .calls[0][0] as OperationEndInfo;
      expect(endCall.error).toBeInstanceOf(Error);
      expect(endCall.error?.message).toBe("Invoke target failed");
    });

    it("should extract error from CallbackDetails for FAILED callback operations", async () => {
      const stepId = "callback-1";
      const hashedId = hashId(stepId);

      const existingStepData: Record<string, Operation> = {
        [hashedId]: {
          Id: hashedId,
          Name: "my-callback",
          Type: OperationType.CALLBACK,
          SubType: "Callback",
          Status: OperationStatus.STARTED,
          StartTimestamp: new Date("2024-01-01T00:00:00Z"),
        },
      };

      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
        NewExecutionState: {
          Operations: [
            {
              Id: hashedId,
              Name: "my-callback",
              Type: OperationType.CALLBACK,
              SubType: "Callback",
              Status: OperationStatus.FAILED,
              StartTimestamp: new Date("2024-01-01T00:00:00Z"),
              CallbackDetails: {
                Error: {
                  ErrorMessage: "Callback failed externally",
                  ErrorType: "CallbackError",
                },
              },
            },
          ],
        },
      });

      const checkpointManager = createCheckpointManagerWithPlugin(
        mockPlugin,
        existingStepData,
      );

      await checkpointManager.checkpoint(stepId, {
        Action: OperationAction.FAIL,
        SubType: "Callback",
        Type: OperationType.CALLBACK,
      });

      expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
      const endCall = mockPlugin.onOperationEnd.mock
        .calls[0][0] as OperationEndInfo;
      expect(endCall.error).toBeInstanceOf(Error);
      expect(endCall.error?.message).toBe("Callback failed externally");
    });
  });
});

describe("CheckpointManager - error isolation (task 3.5)", () => {
  let mockTerminationManager: TerminationManager;
  let mockState: jest.Mocked<DurableExecutionClient>;
  let mockContext: ExecutionContext;
  let mockEmitter: EventEmitter;
  let mockLogger: DurableLogger;

  const stepId = "step-1";
  const hashedStepId = hashId(stepId);
  const mockNewTaskToken = "new-task-token";

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmitter = new EventEmitter();
    mockTerminationManager = new TerminationManager();
    jest.spyOn(mockTerminationManager, "terminate");

    mockState = {
      getExecutionState: jest.fn(),
      checkpoint: jest.fn(),
    };

    const stepData: Record<string, Operation> = {};
    mockContext = {
      durableExecutionArn: "test-durable-execution-arn",
      durableExecutionClient: mockState,
      _stepData: stepData,
      terminationManager: mockTerminationManager,
      pendingCompletions: new Set<string>(),
      getStepData: jest.fn((id: string) => getStepData(stepData, id)),
      requestId: "test-request-id",
      tenantId: undefined,
    } satisfies ExecutionContext;
    mockLogger = createDefaultLogger(mockContext);
  });

  /**
   * Creates a CheckpointManager wired with a composite plugin from createPluginRunner.
   * The stepData is pre-populated with the given initial operations.
   */
  function createManagerWithPlugins(
    plugins: DurableInstrumentationPlugin[],
    initialStepData: Record<string, Operation> = {},
  ): CheckpointManager {
    const compositePlugin = createPluginRunner(plugins);

    return new CheckpointManager(
      mockContext.durableExecutionArn,
      initialStepData,
      mockContext.durableExecutionClient,
      mockContext.terminationManager,
      TEST_CONSTANTS.CHECKPOINT_TOKEN,
      mockEmitter,
      mockLogger,
      new Set<string>(),
      compositePlugin,
      "test-request-id",
    );
  }

  describe("plugin onOperationStart throws synchronously", () => {
    it("checkpoint processing still completes (stepData updated, events emitted)", async () => {
      const throwingPlugin: DurableInstrumentationPlugin = {
        onOperationStart: () => {
          throw new Error("onOperationStart sync error");
        },
      };

      const manager = createManagerWithPlugins([throwingPlugin]);

      // Mock checkpoint API to return a new STARTED operation
      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
        NewExecutionState: {
          Operations: [
            {
              Id: hashedStepId,
              Status: OperationStatus.STARTED,
              Type: OperationType.STEP,
              SubType: OperationSubType.STEP,
              Name: "my-step",
              StartTimestamp: new Date("2024-01-01T00:00:00Z"),
            },
          ],
        },
      });

      // Set up listener to verify stepData updated event fires
      const stepDataUpdated = jest.fn();
      mockEmitter.on("stepDataUpdated", stepDataUpdated);

      // Perform checkpoint — should not throw
      await manager.checkpoint(stepId, {
        Action: OperationAction.START,
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
      });

      // stepData was updated despite plugin error
      expect(stepDataUpdated).toHaveBeenCalledWith(hashedStepId);
      // Termination was not triggered
      expect(mockTerminationManager.terminate).not.toHaveBeenCalled();
    });
  });

  describe("plugin onOperationEnd throws synchronously", () => {
    it("checkpoint processing still completes", async () => {
      const throwingPlugin: DurableInstrumentationPlugin = {
        onOperationEnd: () => {
          throw new Error("onOperationEnd sync error");
        },
      };

      // Pre-populate stepData with a STARTED operation so transition to terminal is detected
      const initialStepData: Record<string, Operation> = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          Type: OperationType.STEP,
          SubType: OperationSubType.STEP,
          StartTimestamp: new Date("2024-01-01T00:00:00Z"),
        } as Operation,
      };

      const manager = createManagerWithPlugins(
        [throwingPlugin],
        initialStepData,
      );

      // Mock checkpoint API to return the operation as SUCCEEDED
      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
        NewExecutionState: {
          Operations: [
            {
              Id: hashedStepId,
              Status: OperationStatus.SUCCEEDED,
              Type: OperationType.STEP,
              SubType: OperationSubType.STEP,
              Name: "my-step",
              StartTimestamp: new Date("2024-01-01T00:00:00Z"),
              EndTimestamp: new Date("2024-01-01T00:01:00Z"),
            },
          ],
        },
      });

      const stepDataUpdated = jest.fn();
      mockEmitter.on("stepDataUpdated", stepDataUpdated);

      // Perform checkpoint — should not throw
      await manager.checkpoint(stepId, {
        Action: OperationAction.SUCCEED,
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
      });

      // stepData was updated despite plugin error
      expect(stepDataUpdated).toHaveBeenCalledWith(hashedStepId);
      expect(mockTerminationManager.terminate).not.toHaveBeenCalled();
    });
  });

  describe("multiple plugins, one throws in onOperationStart", () => {
    it("all other plugins still receive the onOperationStart hook call", async () => {
      const plugin1Calls: unknown[] = [];
      const plugin3Calls: unknown[] = [];

      const plugin1: DurableInstrumentationPlugin = {
        onOperationStart: (info) => {
          plugin1Calls.push(info);
        },
      };
      const throwingPlugin: DurableInstrumentationPlugin = {
        onOperationStart: () => {
          throw new Error("plugin2 error in onOperationStart");
        },
      };
      const plugin3: DurableInstrumentationPlugin = {
        onOperationStart: (info) => {
          plugin3Calls.push(info);
        },
      };

      const manager = createManagerWithPlugins([
        plugin1,
        throwingPlugin,
        plugin3,
      ]);

      // Mock checkpoint API to return a new STARTED operation
      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
        NewExecutionState: {
          Operations: [
            {
              Id: hashedStepId,
              Status: OperationStatus.STARTED,
              Type: OperationType.STEP,
              SubType: OperationSubType.STEP,
              Name: "my-step",
              StartTimestamp: new Date("2024-01-01T00:00:00Z"),
            },
          ],
        },
      });

      await manager.checkpoint(stepId, {
        Action: OperationAction.START,
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
      });

      // plugin1 (before the thrower) received the call
      expect(plugin1Calls).toHaveLength(1);
      expect((plugin1Calls[0] as any).Id).toBe(hashedStepId);

      // plugin3 (after the thrower) also received the call
      expect(plugin3Calls).toHaveLength(1);
      expect((plugin3Calls[0] as any).Id).toBe(hashedStepId);
    });
  });

  describe("plugin returns rejected promise from onOperationEnd", () => {
    it("no unhandled rejection is emitted and checkpoint processing completes", async () => {
      // Track unhandled rejections
      const unhandledRejections: unknown[] = [];
      const rejectionHandler = (reason: unknown) => {
        unhandledRejections.push(reason);
      };
      process.on("unhandledRejection", rejectionHandler);

      const asyncThrowingPlugin: DurableInstrumentationPlugin = {
        onOperationEnd: () => {
          return Promise.reject(new Error("async onOperationEnd error")) as any;
        },
      };

      // Pre-populate stepData with a STARTED operation
      const initialStepData: Record<string, Operation> = {
        [hashedStepId]: {
          Id: hashedStepId,
          Status: OperationStatus.STARTED,
          Type: OperationType.STEP,
          SubType: OperationSubType.STEP,
          StartTimestamp: new Date("2024-01-01T00:00:00Z"),
        } as Operation,
      };

      const manager = createManagerWithPlugins(
        [asyncThrowingPlugin],
        initialStepData,
      );

      // Mock checkpoint API to return the operation as FAILED (terminal status)
      mockState.checkpoint.mockResolvedValueOnce({
        CheckpointToken: mockNewTaskToken,
        NewExecutionState: {
          Operations: [
            {
              Id: hashedStepId,
              Status: OperationStatus.FAILED,
              Type: OperationType.STEP,
              SubType: OperationSubType.STEP,
              Name: "my-step",
              StartTimestamp: new Date("2024-01-01T00:00:00Z"),
              StepDetails: {
                Error: { ErrorMessage: "step failed" },
              },
            },
          ],
        },
      });

      const stepDataUpdated = jest.fn();
      mockEmitter.on("stepDataUpdated", stepDataUpdated);

      // Perform checkpoint — should not throw
      await manager.checkpoint(stepId, {
        Action: OperationAction.FAIL,
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
      });

      // Allow microtask queue to flush (for async rejection suppression)
      await new Promise((resolve) => setImmediate(resolve));

      // stepData was updated
      expect(stepDataUpdated).toHaveBeenCalledWith(hashedStepId);
      // No termination
      expect(mockTerminationManager.terminate).not.toHaveBeenCalled();
      // No unhandled rejections
      expect(unhandledRejections).toHaveLength(0);

      process.removeListener("unhandledRejection", rejectionHandler);
    });
  });
});
