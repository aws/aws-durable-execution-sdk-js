import { OperationAction, OperationType } from "@aws/durable-execution-sdk-js";
import { CheckpointManager } from "../checkpoint-manager";
import { ExecutionManager } from "../execution-manager";
import {
  createExecutionId,
  createInvocationId,
} from "../../utils/tagged-strings";
import { processDrainCheckpointData } from "../../handlers/checkpoint-handlers";

function registerStep(storage: CheckpointManager, id: string): void {
  storage.registerUpdate({
    Id: id,
    Type: OperationType.STEP,
    Action: OperationAction.START,
  });
}

describe("CheckpointManager.drainPendingCheckpointUpdates", () => {
  let storage: CheckpointManager;

  beforeEach(() => {
    storage = new CheckpointManager(createExecutionId("drain-execution-id"));
  });

  afterEach(() => {
    storage.cleanup();
  });

  it("returns the pending updates without waiting, and clears them", () => {
    registerStep(storage, "a");
    registerStep(storage, "b");

    expect(
      storage.drainPendingCheckpointUpdates().map((u) => u.update?.Id),
    ).toEqual(["a", "b"]);
    expect(storage.drainPendingCheckpointUpdates()).toEqual([]);
  });

  it("returns an empty list when nothing is pending", () => {
    expect(storage.drainPendingCheckpointUpdates()).toEqual([]);
  });

  it("releases a waiting poll with no updates", async () => {
    const poll = storage.getPendingCheckpointUpdates();

    expect(storage.drainPendingCheckpointUpdates()).toEqual([]);
    await expect(poll).resolves.toEqual([]);
  });

  it("does not give the drained updates to a poll that was released", async () => {
    // A poll resolved by an update copies the updates only once it resumes. A drain in
    // between takes them first, so the poll resumes to an empty list, not a duplicate.
    const poll = storage.getPendingCheckpointUpdates();
    registerStep(storage, "a");

    expect(
      storage.drainPendingCheckpointUpdates().map((u) => u.update?.Id),
    ).toEqual(["a"]);
    await expect(poll).resolves.toEqual([]);
  });
});

describe("processDrainCheckpointData", () => {
  it("throws for an unknown execution", () => {
    expect(() =>
      processDrainCheckpointData("unknown", new ExecutionManager()),
    ).toThrow("Execution not found");
  });

  it("returns the pending updates of the execution", () => {
    const executionManager = new ExecutionManager();
    const { executionId } = executionManager.startExecution({
      executionId: createExecutionId("drain-handler-execution-id"),
      payload: undefined,
      invocationId: createInvocationId("invocation-id"),
    });
    const storage = executionManager.getCheckpointsByExecution(executionId);
    if (!storage) {
      throw new Error("expected checkpoint storage");
    }
    // Starting the execution queues nothing. Clear anyway so the test only sees its own.
    storage.drainPendingCheckpointUpdates();
    registerStep(storage, "a");

    expect(
      processDrainCheckpointData(executionId, executionManager).operations.map(
        (u) => u.update?.Id,
      ),
    ).toEqual(["a"]);
  });
});
