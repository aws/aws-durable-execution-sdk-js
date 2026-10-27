import {
  OperationAction,
  OperationType,
  OperationUpdate,
} from "@aws/durable-execution-sdk-js";
import { normalizeUpdateIntegers } from "../normalize-update-integers";

describe("normalizeUpdateIntegers", () => {
  it("converts each integer member to the integer that the service reads", () => {
    const update: OperationUpdate = {
      Id: "op-1",
      Type: OperationType.STEP,
      Action: OperationAction.RETRY,
      StepOptions: { NextAttemptDelaySeconds: 2.9 },
      WaitOptions: { WaitSeconds: 1.5 },
      CallbackOptions: { TimeoutSeconds: 0.5, HeartbeatTimeoutSeconds: 1e12 },
    };

    expect(normalizeUpdateIntegers(update)).toEqual({
      ...update,
      StepOptions: { NextAttemptDelaySeconds: 2 },
      WaitOptions: { WaitSeconds: 1 },
      CallbackOptions: {
        TimeoutSeconds: 0,
        HeartbeatTimeoutSeconds: 2_147_483_647,
      },
    });
  });

  it("does not change the input update", () => {
    const update: OperationUpdate = {
      Id: "op-1",
      Type: OperationType.WAIT,
      Action: OperationAction.START,
      WaitOptions: { WaitSeconds: 1.5 },
    };

    normalizeUpdateIntegers(update);

    expect(update.WaitOptions).toEqual({ WaitSeconds: 1.5 });
  });

  it("keeps absent members absent", () => {
    const update: OperationUpdate = {
      Id: "op-1",
      Type: OperationType.CALLBACK,
      Action: OperationAction.START,
      CallbackOptions: {},
    };

    const normalized = normalizeUpdateIntegers(update);

    expect(normalized).toEqual(update);
    expect(normalized.CallbackOptions).not.toHaveProperty("TimeoutSeconds");
    expect(normalized).not.toHaveProperty("WaitOptions");
  });
});
