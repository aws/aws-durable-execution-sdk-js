// Replay table for createCallback (Type CALLBACK, SubType Callback):
//
// | Record status   | result promise                                               |
// |-----------------|--------------------------------------------------------------|
// | none            | send START with CallbackOptions, then as the new record      |
// | SUCCEEDED       | resolve to CallbackDetails.Result, a raw string (not JSON)   |
// | FAILED          | reject fromErrorObject(CallbackDetails.Error)                |
// | TIMED_OUT       | reject with errorType CallbackTimeoutError                   |
// | anything else   | block until an outside system completes the callback         |
//
// callbackId always comes from CallbackDetails.CallbackId, which the service assigns.

import { DurableOperationError, fromErrorObject } from "../errors.js";

const clean = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

export function createCallback(ctx, opts = {}) {
  // The id is taken now, before any await (AGENTS.md 2.4).
  return runCallback(ctx, ctx._nextId(), opts);
}

async function runCallback(
  ctx,
  rawId,
  { name, timeoutSeconds, heartbeatTimeoutSeconds },
) {
  const execution = ctx._execution;
  const meta = { type: "CALLBACK", subType: "Callback", name };
  let record = ctx._lookup(rawId);
  if (record && !ctx._validateReplay(record, meta))
    return new Promise(() => {});
  if (!record) {
    const options = clean({
      TimeoutSeconds: timeoutSeconds,
      HeartbeatTimeoutSeconds: heartbeatTimeoutSeconds,
    });
    await execution.checkpoint({
      ...ctx._base(rawId, meta),
      Action: "START",
      ...(Object.keys(options).length > 0 && { CallbackOptions: options }),
    });
    record = ctx._lookup(rawId);
  }
  const details = record?.CallbackDetails;
  const result = outcome(execution, record?.Status, details);
  // A result that the user never awaits must not crash the process when it rejects.
  // The user's own await still sees the rejection.
  result.catch(() => {});
  return { callbackId: details?.CallbackId, result };
}

// A native promise, created eagerly. A blocked one counts at once (AGENTS.md 2.5).
function outcome(execution, status, details) {
  if (status === "SUCCEEDED") return Promise.resolve(details?.Result);
  if (status === "FAILED") {
    return Promise.reject(fromErrorObject(details?.Error, "CallbackError"));
  }
  if (status === "TIMED_OUT") {
    const message = details?.Error?.ErrorMessage ?? "Callback timed out";
    return Promise.reject(
      new DurableOperationError({ errorType: "CallbackTimeoutError", message }),
    );
  }
  return execution.block();
}
