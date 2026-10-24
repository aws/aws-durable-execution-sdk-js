// Replay table for createCallback (Type CALLBACK, SubType Callback or the caller's
// subType):
//
// | Record status   | result promise                                               |
// |-----------------|--------------------------------------------------------------|
// | none            | send START with CallbackOptions, then as the new record      |
// | SUCCEEDED       | resolve to CallbackDetails.Result, a raw string (not JSON),  |
// |                 | or to serdes.deserialize of it                               |
// | FAILED          | reject fromErrorObject(CallbackDetails.Error)                |
// | TIMED_OUT       | reject with errorType CallbackTimeoutError                   |
// | anything else   | block until an outside system completes the callback         |
//
// A blocked result wakes when a checkpoint response changes the callback's record
// (README 2.5). It then applies this table to the new record.
// callbackId always comes from CallbackDetails.CallbackId, which the service assigns.

import { DurableOperationError, fromErrorObject } from "../errors.js";
import { deserialize } from "../serdes.js";

const clean = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

export function createCallback(ctx, opts = {}) {
  // The id is taken now, before any await (README 2.4).
  return runCallback(ctx, ctx._nextId(), opts);
}

async function runCallback(
  ctx,
  rawId,
  { name, timeoutSeconds, heartbeatTimeoutSeconds, subType, serdes },
) {
  // Like the full SDK, an empty subType selects the default.
  const meta = { type: "CALLBACK", subType: subType || "Callback", name };
  let record = ctx._lookup(rawId);
  if (!ctx._mayRun(record, meta)) return new Promise(() => {});
  if (!record) {
    const options = clean({
      TimeoutSeconds: timeoutSeconds,
      HeartbeatTimeoutSeconds: heartbeatTimeoutSeconds,
    });
    await ctx._checkpoint({
      ...ctx._base(rawId, meta),
      Action: "START",
      ...(Object.keys(options).length > 0 && { CallbackOptions: options }),
    });
    record = ctx._lookup(rawId);
  }
  const details = record?.CallbackDetails;
  const result = outcome(ctx, rawId, serdes);
  // A result that the user never awaits must not crash the process when it rejects.
  // The user's own await still sees the rejection.
  result.catch(() => {});
  return { callbackId: details?.CallbackId, result };
}

// A native promise, created eagerly. The async function runs up to its first await at
// once. So a blocked one counts as blocked at once (README 2.5). The block resolves
// when a checkpoint response changes the record. The loop then reads it again.
// An outside system sent the result. So even the first run calls deserialize.
async function outcome(ctx, rawId, serdes) {
  for (;;) {
    const record = ctx._lookup(rawId);
    const details = record?.CallbackDetails;
    const status = record?.Status;
    if (status === "SUCCEEDED") {
      return serdes
        ? deserialize(ctx, serdes, details?.Result, rawId)
        : details?.Result;
    }
    if (status === "FAILED") {
      throw fromErrorObject(details?.Error, "CallbackError");
    }
    if (status === "TIMED_OUT") {
      const message = details?.Error?.ErrorMessage ?? "Callback timed out";
      throw new DurableOperationError({
        errorType: "CallbackTimeoutError",
        message,
      });
    }
    await ctx._block(rawId);
  }
}
