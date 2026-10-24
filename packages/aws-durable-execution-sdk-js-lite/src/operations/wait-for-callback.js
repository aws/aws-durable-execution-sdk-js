// Replay table for waitForCallback (Type CONTEXT, SubType WaitForCallback):
//
// The operation is a child context with two children: a callback ("N-1") and a step
// that runs the submitter ("N-2"). The child context replay table applies
// (child-context.js). A completed context returns its result and runs nothing.
// While it is open, the callback and the step replay from their own records, so the
// submitter runs once per successful attempt.
//
// The children have no Name, like the names the full SDK checkpoints. Errors keep their
// errorType, for example CallbackTimeoutError or the submitter error's name.
//
// The context stores the raw callback string as JSON. serdes.deserialize then reads
// that string in every run, with the context's raw id as entityId, like the full SDK.

import { deserialize } from "../serdes.js";
import { runChild } from "./child-context.js";

export function waitForCallback(
  ctx,
  {
    name,
    submitter,
    timeoutSeconds,
    heartbeatTimeoutSeconds,
    retryStrategy,
    serdes,
  },
) {
  // The id is taken now, before any await (README 2.4).
  const rawId = ctx._nextId();
  const raw = runChild(ctx, rawId, {
    name,
    subType: "WaitForCallback",
    fn: async ({ ctx: child }) => {
      const { callbackId, result } = await child.createCallback({
        timeoutSeconds,
        heartbeatTimeoutSeconds,
      });
      await child.step({
        // The submitter's return value is not part of the result, so it is not stored.
        fn: async ({ logger }) => {
          await submitter({ callbackId, logger });
        },
        retryStrategy,
      });
      return await result;
    },
  });
  return serdes
    ? raw.then((data) => deserialize(ctx, serdes, data, rawId))
    : raw;
}
