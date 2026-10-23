// Replay table for child contexts (Type CONTEXT, SubType RunInChildContext, or the
// caller's SubType for waitForCallback, map and parallel):
//
// | Record status                  | Behavior                                          |
// |--------------------------------|---------------------------------------------------|
// | none                           | send START (not awaited), run fn, SUCCEED or FAIL |
// | STARTED                        | run fn again, children replay from their records  |
// | SUCCEEDED                      | return JSON.parse(ContextDetails.Result), no fn   |
// | SUCCEEDED with ReplayChildren  | run fn again in a replay-only ctx, no checkpoint  |
// | FAILED                         | throw fromErrorObject(ContextDetails.Error), no fn |
//
// The service prunes the children of a completed context. So fn must not run again
// unless ReplayChildren kept them: its steps would run a second time.

import { fromErrorObject, toErrorObject } from "../errors.js";

// The service limits one checkpoint payload. A larger result is rebuilt on replay.
const MAX_PAYLOAD_BYTES = 256 * 1024;
const parse = (s) => (s == null || s === "" ? undefined : JSON.parse(s));

// Internal: map, parallel and waitForCallback use it with their own subType.
export function childContext(ctx, opts) {
  // The id is taken now, before any await (AGENTS.md 2.4).
  return runChild(ctx, ctx._nextId(), opts);
}

export function runInChildContext(ctx, { name, fn }) {
  return childContext(ctx, { name, fn, subType: "RunInChildContext" });
}

async function runChild(ctx, rawId, { name, fn, subType, summary }) {
  const meta = { type: "CONTEXT", subType, name };
  const record = ctx._lookup(rawId);
  if (!ctx._mayRun(record, meta)) return new Promise(() => {});
  const details = record?.ContextDetails;
  const replayChildren = record?.Status === "SUCCEEDED";
  if (replayChildren && !details?.ReplayChildren) return parse(details?.Result);
  if (record?.Status === "FAILED") {
    throw fromErrorObject(details?.Error, "ChildContextError");
  }
  const child = ctx._child(rawId, replayChildren);
  const update = (fields) => ({ ...ctx._base(rawId, meta), ...fields });
  // The context's own updates go through the child ctx. A batch abandons an item by its
  // ctx, so an abandoned item's SUCCEED or FAIL is not sent either.
  // START can travel with the first child update. Nothing needs it saved first.
  if (!record) child._checkpoint(update({ Action: "START" }));

  let result;
  try {
    result = await fn({ ctx: child });
  } catch (err) {
    const errorObject = toErrorObject(err);
    if (!replayChildren) {
      await child._checkpoint(update({ Action: "FAIL", Error: errorObject }));
    }
    throw fromErrorObject(errorObject, "ChildContextError");
  }
  // The context already succeeded. Rebuilding its result changes nothing on the service.
  if (replayChildren) return result;
  const payload = JSON.stringify(result);
  const large =
    payload !== undefined && Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES;
  // summary: map and parallel save what a re-run needs to rebuild the same result.
  await child._checkpoint(
    update(
      large
        ? {
            Action: "SUCCEED",
            Payload: summary?.(result) ?? "",
            ContextOptions: { ReplayChildren: true },
          }
        : { Action: "SUCCEED", Payload: payload },
    ),
  );
  // The first run returns fn's own value. Only a replay parses the stored JSON
  // (AGENTS.md 2.6).
  return result;
}
