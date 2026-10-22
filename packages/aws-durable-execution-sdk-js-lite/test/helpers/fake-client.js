import { hashId } from "../../src/ids.js";

export const ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:f:$LATEST/durable-execution/x/y";
export const EXECUTION_ID = "execution-op-id";

// A fake of the two durable APIs. It records requests and, by default, applies updates
// the way the service does. Scripted responses (objects, Errors or functions) take
// precedence, in order.
export function createFakeClient({ operations = [], pages = [] } = {}) {
  const ops = new Map(operations.map((op) => [op.Id, structuredClone(op)]));
  const scripted = [];
  const checkpoints = [];
  const stateRequests = [];
  let gate;
  let n = 0;

  function apply(u) {
    const prev = ops.get(u.Id);
    const op = structuredClone(prev) ?? {
      Id: u.Id,
      ...(u.ParentId && { ParentId: u.ParentId }),
      ...(u.Name !== undefined && { Name: u.Name }),
      Type: u.Type,
      ...(u.SubType && { SubType: u.SubType }),
      StartTimestamp: 1,
    };
    const attempt = op.StepDetails?.Attempt ?? 0;
    if (u.Action === "START") op.Status = "STARTED";
    if (u.Type === "STEP") {
      // Like the service: START keeps Attempt; SUCCEED, FAIL and RETRY finish one attempt.
      if (u.Action === "SUCCEED") {
        op.Status = "SUCCEEDED";
        op.StepDetails = { Attempt: attempt + 1, Result: u.Payload };
      } else if (u.Action === "FAIL") {
        op.Status = "FAILED";
        op.StepDetails = { Attempt: attempt + 1, Error: u.Error };
      } else if (u.Action === "RETRY") {
        op.Status = "PENDING";
        op.StepDetails = {
          Attempt: attempt + 1,
          Error: u.Error,
          NextAttemptTimestamp: 2,
        };
      }
    } else if (u.Action === "SUCCEED") op.Status = "SUCCEEDED";
    else if (u.Action === "FAIL") op.Status = "FAILED";
    ops.set(u.Id, op);
    return op;
  }

  return {
    ops,
    checkpoints,
    stateRequests,
    // Queue a response for the next checkpoint call.
    script(...responses) {
      scripted.push(...responses);
    },
    // Holds checkpoint responses until the returned function is called.
    hold() {
      let release;
      gate = new Promise((r) => {
        release = r;
      });
      return () => {
        gate = undefined;
        release();
      };
    },
    async checkpoint(request) {
      checkpoints.push(structuredClone(request));
      if (gate) await gate;
      const next = scripted.shift();
      if (next instanceof Error) throw next;
      if (typeof next === "function") return next(request);
      if (next) return next;
      const changed = request.Updates.map(apply);
      return {
        CheckpointToken: `token-${++n}`,
        NewExecutionState: { Operations: structuredClone(changed) },
      };
    },
    async getExecutionState(request) {
      stateRequests.push(request);
      return pages.shift();
    },
  };
}

export function executionOp(input) {
  return {
    Id: EXECUTION_ID,
    Type: "EXECUTION",
    Status: "STARTED",
    ExecutionDetails:
      input === undefined ? {} : { InputPayload: JSON.stringify(input) },
  };
}

// A STEP record as the service would store it for a raw id.
export function stepRecord(rawId, Status, { name, ...StepDetails } = {}) {
  return {
    Id: hashId(rawId),
    Type: "STEP",
    SubType: "Step",
    ...(name !== undefined && { Name: name }),
    Status,
    StartTimestamp: 1,
    StepDetails,
  };
}

export function event(operations = [], { input, NextMarker } = {}) {
  return {
    DurableExecutionArn: ARN,
    CheckpointToken: "token-0",
    InitialExecutionState: {
      Operations: [executionOp(input), ...operations],
      ...(NextMarker && { NextMarker }),
    },
  };
}

export function httpError(status, name, message = "boom") {
  return Object.assign(new Error(message), { status, name });
}
