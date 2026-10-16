import { OperationSubType } from "../../types";
import { EventEmitter } from "events";
import { CheckpointManager } from "./checkpoint-manager";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { createDefaultLogger } from "../logger/default-logger";
import { InvocationLifecycle } from "../invocation-lifecycle/invocation-lifecycle";
import { OperationLifecycleState } from "../../types/operation-lifecycle-state";
import {
  OperationType,
  type CheckpointDurableExecutionResponse,
} from "../../types/wire";
import { CHECKPOINT_TERMINATION_COOLDOWN_MS } from "../constants/constants";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function fixture(lifecycle?: InvocationLifecycle) {
  const checkpoint = jest.fn(
    async (): Promise<CheckpointDurableExecutionResponse> => ({
      CheckpointToken: "next",
      NewExecutionState: undefined,
    }),
  );
  const terminate = new TerminationManager();
  const end = jest.spyOn(terminate, "terminate");
  const emitter = new EventEmitter();
  const manager = new CheckpointManager(
    "arn",
    {},
    { checkpoint, getExecutionState: async () => ({ Operations: [] }) },
    terminate,
    "token",
    emitter,
    createDefaultLogger(),
    new Set(),
    {},
    "request",
    () => Infinity,
    lifecycle,
  );
  return { checkpoint, manager, emitter, end };
}

describe("CheckpointManager invocation disposal", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("discards queued and late checkpoint/force requests without waking their user stacks", async () => {
    const { manager, checkpoint } = fixture();
    const resumed = jest.fn();
    void manager
      .checkpoint("before", { Type: "STEP", Action: "START" })
      .then(resumed);
    void manager.forceCheckpoint().then(resumed);
    manager.dispose();
    void manager
      .checkpoint("after", { Type: "STEP", Action: "SUCCEED" })
      .then(resumed);
    void manager.forceCheckpoint().then(resumed);
    expect(
      await manager.checkpointExecutionResult("result", {
        Type: "EXECUTION",
        Action: "SUCCEED",
      }),
    ).toBe("abandoned");
    await manager.waitForQueueCompletion();
    await jest.advanceTimersByTimeAsync(1000);
    expect(checkpoint).not.toHaveBeenCalled();
    expect(resumed).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("does not publish an in-flight response or send the next batch after disposal", async () => {
    const { manager, checkpoint, emitter } = fixture();
    const release = deferred<CheckpointDurableExecutionResponse>();
    checkpoint.mockImplementation(() => release.promise);
    const changed = jest.fn();
    emitter.on("stepDataUpdated", changed);
    const resumed = jest.fn();
    for (let index = 0; index < 251; index++)
      void manager
        .checkpoint(String(index), { Type: "STEP", Action: "START" })
        .then(resumed);
    await jest.advanceTimersByTimeAsync(0);
    expect(checkpoint).toHaveBeenCalledTimes(1);
    manager.dispose();
    release.resolve({
      CheckpointToken: "late",
      NewExecutionState: {
        Operations: [
          {
            Id: "late",
            Type: "STEP",
            Status: "SUCCEEDED",
            StartTimestamp: new Date(),
          },
        ],
      },
    });
    await jest.advanceTimersByTimeAsync(1000);
    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
    expect(resumed).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("does not rearm a poll whose force-refresh finishes after disposal", async () => {
    const { manager } = fixture();
    const release = deferred<void>();
    const force = jest
      .spyOn(manager, "forceCheckpoint")
      .mockImplementation(() => release.promise);
    manager.markOperationState("wait", OperationLifecycleState.IDLE_AWAITED, {
      metadata: {
        stepId: "wait",
        type: OperationType.WAIT,
        subType: OperationSubType.WAIT,
      },
      endTimestamp: new Date(),
    });
    void manager.waitForStatusChange("wait");
    await jest.advanceTimersByTimeAsync(0);
    expect(force).toHaveBeenCalledTimes(1);
    manager.dispose();
    release.resolve();
    await jest.advanceTimersByTimeAsync(1000);
    expect(force).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("does not execute a previously armed suspension timer while final checkpoints drain", async () => {
    const lifecycle = new InvocationLifecycle(() => Infinity);
    const { manager, end } = fixture(lifecycle);
    manager.markOperationState("wait", OperationLifecycleState.IDLE_AWAITED, {
      metadata: {
        stepId: "wait",
        type: OperationType.WAIT,
        subType: OperationSubType.WAIT,
      },
    });
    lifecycle.closeAdmission();
    await jest.advanceTimersByTimeAsync(CHECKPOINT_TERMINATION_COOLDOWN_MS + 1);
    expect(end).not.toHaveBeenCalled();
    manager.dispose();
    lifecycle.dispose();
    expect(jest.getTimerCount()).toBe(0);
  });
});
