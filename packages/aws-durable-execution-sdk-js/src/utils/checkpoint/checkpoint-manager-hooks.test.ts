/**
 * Unit tests for CheckpointManager hook dispatch.
 *
 * Tests that `updateStepDataFromCheckpointResponse` fires the correct plugin hooks
 * based on operation state transitions detected in checkpoint responses.
 *
 * Requirements: 1.1, 1.2, 1.3, 4.1, 4.2, 6.1, 6.3
 */
import {
  Operation,
  OperationStatus,
  OperationType,
  CheckpointDurableExecutionResponse,
} from "@aws-sdk/client-lambda";
import { CheckpointManager } from "./checkpoint-manager";
import { EventEmitter } from "events";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { OperationSubType } from "../../types/core";
import {
  DurableInstrumentationPlugin,
  OperationInfo,
  OperationEndInfo,
  OperationChangeInfo,
} from "../../types/plugin";
import { createDefaultLogger } from "../logger/default-logger";
import { DurableLogger } from "../../types/durable-logger";

// Mock the logger to avoid noisy output
jest.mock("../../utils/logger/logger", () => ({
  log: jest.fn(),
}));

// --- Test Helpers ---

function createCheckpointManagerWithPlugin(
  plugin: DurableInstrumentationPlugin,
  initialStepData: Record<string, Operation> = {},
): { manager: CheckpointManager; stepData: Record<string, Operation> } {
  const stepData = { ...initialStepData };
  const stepDataEmitter = new EventEmitter();
  const terminationManager = new TerminationManager();
  const mockStorage = {
    checkpoint: jest.fn(),
    getExecutionState: jest.fn(),
  };
  const mockLogger = createDefaultLogger({
    durableExecutionArn: "test-arn",
    requestId: "test-request-id",
  } as any) as DurableLogger;

  const manager = new CheckpointManager(
    "test-arn",
    stepData,
    mockStorage as any,
    terminationManager,
    "test-token",
    stepDataEmitter,
    mockLogger,
    new Set<string>(),
    plugin,
    "test-request-id",
  );

  return { manager, stepData };
}

function mockCheckpointResponse(
  manager: CheckpointManager,
  operations: Operation[],
): void {
  const response: CheckpointDurableExecutionResponse = {
    CheckpointToken: "new-token",
    NewExecutionState: { Operations: operations },
  };
  (manager as any).storage.checkpoint.mockResolvedValue(response);
}

// --- Tests ---

describe("CheckpointManager hook dispatch", () => {
  describe("onOperationStart", () => {
    it("fires when a new operation with STARTED status appears in the checkpoint response", async () => {
      const firstStartCalls: OperationInfo[] = [];
      const plugin: DurableInstrumentationPlugin = {
        onOperationStart: (info: OperationInfo) => {
          firstStartCalls.push(info);
        },
      };

      const { manager } = createCheckpointManagerWithPlugin(plugin);

      const newOperation: Operation = {
        Id: "op-new-1",
        Status: OperationStatus.STARTED,
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
        Name: "my-step",
        StartTimestamp: new Date("2024-01-01T00:00:00Z"),
      };

      mockCheckpointResponse(manager, [newOperation]);

      await manager.checkpoint("test-step", {
        Action: "START",
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      expect(firstStartCalls).toHaveLength(1);
      expect(firstStartCalls[0].Id).toBe("op-new-1");
      expect(firstStartCalls[0].Name).toBe("my-step");
      expect(firstStartCalls[0].Type).toBe(OperationType.STEP);
      expect(firstStartCalls[0].SubType).toBe(OperationSubType.STEP);
    });

    it("does NOT fire when an operation already existed in stepData (even if still STARTED)", async () => {
      const firstStartCalls: OperationInfo[] = [];
      const plugin: DurableInstrumentationPlugin = {
        onOperationStart: (info: OperationInfo) => {
          firstStartCalls.push(info);
        },
      };

      // Pre-populate stepData with an existing operation
      const existingOp: Operation = {
        Id: "op-existing",
        Status: OperationStatus.STARTED,
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
        Name: "existing-step",
        StartTimestamp: new Date("2024-01-01T00:00:00Z"),
      };

      const { manager } = createCheckpointManagerWithPlugin(plugin, {
        "op-existing": existingOp,
      });

      // Checkpoint response includes the same operation (still STARTED)
      const responseOp: Operation = {
        Id: "op-existing",
        Status: OperationStatus.STARTED,
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
        Name: "existing-step",
        StartTimestamp: new Date("2024-01-01T00:00:00Z"),
      };

      mockCheckpointResponse(manager, [responseOp]);

      await manager.checkpoint("test-step", {
        Action: "START",
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      expect(firstStartCalls).toHaveLength(0);
    });
  });

  describe("onOperationEnd", () => {
    it("fires when an operation transitions to SUCCEEDED status", async () => {
      const firstEndCalls: OperationEndInfo[] = [];
      const plugin: DurableInstrumentationPlugin = {
        onOperationEnd: (info: OperationEndInfo) => {
          firstEndCalls.push(info);
        },
      };

      // Operation was previously STARTED
      const existingOp: Operation = {
        Id: "op-completing",
        Status: OperationStatus.STARTED,
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
        Name: "completing-step",
        StartTimestamp: new Date("2024-01-01T00:00:00Z"),
      };

      const { manager } = createCheckpointManagerWithPlugin(plugin, {
        "op-completing": existingOp,
      });

      // Now the checkpoint response shows it as SUCCEEDED
      const responseOp: Operation = {
        Id: "op-completing",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
        Name: "completing-step",
        StartTimestamp: new Date("2024-01-01T00:00:00Z"),
        EndTimestamp: new Date("2024-01-01T00:01:00Z"),
      };

      mockCheckpointResponse(manager, [responseOp]);

      await manager.checkpoint("test-step", {
        Action: "SUCCEED",
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      expect(firstEndCalls).toHaveLength(1);
      expect(firstEndCalls[0].Id).toBe("op-completing");
      expect(firstEndCalls[0].error).toBeUndefined();
    });

    it("fires when an operation transitions to FAILED status (with error)", async () => {
      const firstEndCalls: OperationEndInfo[] = [];
      const plugin: DurableInstrumentationPlugin = {
        onOperationEnd: (info: OperationEndInfo) => {
          firstEndCalls.push(info);
        },
      };

      // Operation was previously STARTED
      const existingOp: Operation = {
        Id: "op-failing",
        Status: OperationStatus.STARTED,
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
        Name: "failing-step",
        StartTimestamp: new Date("2024-01-01T00:00:00Z"),
      };

      const { manager } = createCheckpointManagerWithPlugin(plugin, {
        "op-failing": existingOp,
      });

      // Now the checkpoint response shows it as FAILED with error details
      const responseOp: Operation = {
        Id: "op-failing",
        Status: OperationStatus.FAILED,
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
        Name: "failing-step",
        StartTimestamp: new Date("2024-01-01T00:00:00Z"),
        EndTimestamp: new Date("2024-01-01T00:01:00Z"),
        StepDetails: {
          Error: { ErrorMessage: "Something went wrong" },
        },
      };

      mockCheckpointResponse(manager, [responseOp]);

      await manager.checkpoint("test-step", {
        Action: "FAIL",
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      expect(firstEndCalls).toHaveLength(1);
      expect(firstEndCalls[0].Id).toBe("op-failing");
      expect(firstEndCalls[0].error).toBeInstanceOf(Error);
      expect(firstEndCalls[0].error?.message).toBe("Something went wrong");
    });

    it("does NOT fire when operation was already terminal in stepData", async () => {
      const firstEndCalls: OperationEndInfo[] = [];
      const plugin: DurableInstrumentationPlugin = {
        onOperationEnd: (info: OperationEndInfo) => {
          firstEndCalls.push(info);
        },
      };

      // Operation was already SUCCEEDED
      const existingOp: Operation = {
        Id: "op-already-done",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
        Name: "done-step",
        StartTimestamp: new Date("2024-01-01T00:00:00Z"),
        EndTimestamp: new Date("2024-01-01T00:01:00Z"),
      };

      const { manager } = createCheckpointManagerWithPlugin(plugin, {
        "op-already-done": existingOp,
      });

      // Checkpoint response still shows it as SUCCEEDED (no transition)
      const responseOp: Operation = {
        Id: "op-already-done",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
        Name: "done-step",
        StartTimestamp: new Date("2024-01-01T00:00:00Z"),
        EndTimestamp: new Date("2024-01-01T00:01:00Z"),
      };

      mockCheckpointResponse(manager, [responseOp]);

      await manager.checkpoint("test-step", {
        Action: "START",
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      expect(firstEndCalls).toHaveLength(0);
    });
  });

  describe("onOperationChange", () => {
    it("fires when any operation status changes", async () => {
      const changeCalls: OperationChangeInfo[] = [];
      const plugin: DurableInstrumentationPlugin = {
        onOperationChange: (info: OperationChangeInfo) => {
          changeCalls.push(info);
        },
      };

      // Operation was previously STARTED
      const existingOp: Operation = {
        Id: "op-changing",
        Status: OperationStatus.STARTED,
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
        Name: "changing-step",
        StartTimestamp: new Date("2024-01-01T00:00:00Z"),
      };

      const { manager } = createCheckpointManagerWithPlugin(plugin, {
        "op-changing": existingOp,
      });

      // Checkpoint response shows the operation as SUCCEEDED (status changed)
      const responseOp: Operation = {
        Id: "op-changing",
        Status: OperationStatus.SUCCEEDED,
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
        Name: "changing-step",
        StartTimestamp: new Date("2024-01-01T00:00:00Z"),
        EndTimestamp: new Date("2024-01-01T00:01:00Z"),
      };

      mockCheckpointResponse(manager, [responseOp]);

      await manager.checkpoint("test-step", {
        Action: "SUCCEED",
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      expect(changeCalls).toHaveLength(1);
      expect(changeCalls[0].requestId).toBe("test-request-id");
      expect(changeCalls[0].executionArn).toBe("test-arn");
      expect(changeCalls[0].updatedOperations["op-changing"]).toBeDefined();
      expect(changeCalls[0].updatedOperations["op-changing"].Status).toBe(
        OperationStatus.SUCCEEDED,
      );
      expect(changeCalls[0].operations).toBeDefined();
    });

    it("does NOT fire when no status changes occur", async () => {
      const changeCalls: OperationChangeInfo[] = [];
      const plugin: DurableInstrumentationPlugin = {
        onOperationChange: (info: OperationChangeInfo) => {
          changeCalls.push(info);
        },
      };

      // Operation was already STARTED
      const existingOp: Operation = {
        Id: "op-same",
        Status: OperationStatus.STARTED,
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
        Name: "same-step",
        StartTimestamp: new Date("2024-01-01T00:00:00Z"),
      };

      const { manager } = createCheckpointManagerWithPlugin(plugin, {
        "op-same": existingOp,
      });

      // Checkpoint response shows the same status
      const responseOp: Operation = {
        Id: "op-same",
        Status: OperationStatus.STARTED,
        Type: OperationType.STEP,
        SubType: OperationSubType.STEP,
        Name: "same-step",
        StartTimestamp: new Date("2024-01-01T00:00:00Z"),
      };

      mockCheckpointResponse(manager, [responseOp]);

      await manager.checkpoint("test-step", {
        Action: "START",
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });

      expect(changeCalls).toHaveLength(0);
    });
  });
});
