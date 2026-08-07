import {
  OperationAction,
  OperationStatus,
  OperationType,
} from "@aws/durable-execution-sdk-js";
import { EventType } from "@aws-sdk/client-lambda";
import { CheckpointManager } from "../checkpoint-manager";
import { createExecutionId } from "../../utils/tagged-strings";

/**
 * The SDK's oversized-result path checkpoints the return value as its own
 * EXECUTION-typed SUCCEED update with a synthetic `execution-result-<timestamp>`
 * id, then returns `{ Status: SUCCEEDED, Result: "" }` from the invocation.
 *
 * The real service applies any EXECUTION-typed update to the execution itself,
 * ignoring that id, and then ignores the invocation response because the
 * execution is already terminal. A real `GetDurableExecutionHistory` for such an
 * execution contains exactly one `ExecutionSucceeded`, keyed by the execution id
 * and carrying the oversized payload. These tests pin that behavior.
 */
describe("CheckpointManager oversized execution result", () => {
  let storage: CheckpointManager;

  beforeEach(() => {
    storage = new CheckpointManager(createExecutionId("test-execution-id"));
  });

  afterEach(() => {
    storage.cleanup();
  });

  it("applies an EXECUTION-typed checkpoint to the execution operation, not a new one", () => {
    const initial = storage.initialize();
    const executionId = initial.operation.Id;

    storage.registerUpdate({
      Id: "execution-result-1700000000000",
      Type: OperationType.EXECUTION,
      Action: OperationAction.SUCCEED,
      Payload: '"oversized"',
    });

    // No separate operation was created for the synthetic id.
    expect(storage.getOperationData("execution-result-1700000000000")).toBe(
      undefined,
    );

    const execution = storage.getOperationData(executionId);
    expect(execution?.operation.Status).toBe(OperationStatus.SUCCEEDED);

    const succeeded = (execution?.events ?? []).filter(
      (event) => event.EventType === EventType.ExecutionSucceeded,
    );
    expect(succeeded).toHaveLength(1);
    expect(succeeded[0].Id).toBe(executionId);
    expect(storage.isExecutionCompleted()).toBe(true);
  });

  it("ignores the invocation response once the execution is already terminal", () => {
    const initial = storage.initialize();
    const executionId = initial.operation.Id;

    storage.registerUpdate({
      Id: "execution-result-1700000000000",
      Type: OperationType.EXECUTION,
      Action: OperationAction.SUCCEED,
      Payload: '"oversized"',
    });

    // This is what the orchestrator does when the invocation returns SUCCEEDED.
    // The service would not record a second completion, and neither should we.
    storage.updateOperation(
      executionId,
      { Status: OperationStatus.SUCCEEDED },
      "",
      undefined,
    );

    const succeeded = (
      storage.getOperationData(executionId)?.events ?? []
    ).filter((event) => event.EventType === EventType.ExecutionSucceeded);
    expect(succeeded).toHaveLength(1);
  });

  it("publishes the ignored response without merging or adding events", async () => {
    const initial = storage.initialize();
    const executionId = initial.operation.Id;

    storage.registerUpdate({
      Id: "execution-result-1700000000000",
      Type: OperationType.EXECUTION,
      Action: OperationAction.SUCCEED,
      Payload: '"oversized"',
    });

    // Drain the checkpoint's own update so anything left is attributable to the
    // finalization below.
    await storage.getPendingCheckpointUpdates();

    storage.updateOperation(
      executionId,
      { Status: OperationStatus.SUCCEEDED },
      "",
      undefined,
    );

    // An update must still be published: the invocation only runs to completion
    // once one is, and without it the run records no InvocationCompleted event
    // and `getInvocations()` comes back empty.
    const published = await storage.getPendingCheckpointUpdates();
    expect(published).toHaveLength(1);

    // But it carries no new history events, so the terminal event is not
    // duplicated...
    const succeeded = published[0].events.filter(
      (event) => event.EventType === EventType.ExecutionSucceeded,
    );
    expect(succeeded).toHaveLength(1);

    // ...and the payload is the checkpoint's, not the empty response body.
    expect(succeeded[0].ExecutionSucceededDetails?.Result?.Payload).toBe(
      '"oversized"',
    );
  });

  it("does not let a late contradictory status overwrite the terminal state", () => {
    const initial = storage.initialize();
    const executionId = initial.operation.Id;

    storage.registerUpdate({
      Id: "execution-result-1700000000000",
      Type: OperationType.EXECUTION,
      Action: OperationAction.SUCCEED,
      Payload: '"oversized"',
    });

    // The response contradicts the checkpoint. The stored operation must not
    // drift away from the recorded history.
    storage.updateOperation(
      executionId,
      { Status: OperationStatus.FAILED },
      undefined,
      { ErrorMessage: "late failure" },
    );

    const stored = storage.getOperationData(executionId);
    expect(stored?.operation.Status).toBe(OperationStatus.SUCCEEDED);

    const terminal = (stored?.events ?? []).filter(
      (event) =>
        event.EventType === EventType.ExecutionSucceeded ||
        event.EventType === EventType.ExecutionFailed,
    );
    expect(terminal).toHaveLength(1);
    expect(terminal[0].EventType).toBe(EventType.ExecutionSucceeded);
  });

  it("still records the terminal event on the ordinary inline path", () => {
    const initial = storage.initialize();
    const executionId = initial.operation.Id;

    storage.updateOperation(
      executionId,
      { Status: OperationStatus.SUCCEEDED },
      '"small"',
      undefined,
    );

    const succeeded = (
      storage.getOperationData(executionId)?.events ?? []
    ).filter((event) => event.EventType === EventType.ExecutionSucceeded);
    expect(succeeded).toHaveLength(1);
    expect(succeeded[0].Id).toBe(executionId);
  });
});
