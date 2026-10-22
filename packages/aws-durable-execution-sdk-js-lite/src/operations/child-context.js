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

async function runChild(ctx, rawId, { name, fn, subType }) {
  const execution = ctx._execution;
  const meta = { type: "CONTEXT", subType, name };
  const record = ctx._lookup(rawId);
  if (!ctx._mayRun(record, meta)) return new Promise(() => {});
  const details = record?.ContextDetails;
  const replayChildren = record?.Status === "SUCCEEDED";
  if (replayChildren && !details?.ReplayChildren) return parse(details?.Result);
  if (record?.Status === "FAILED") {
    throw fromErrorObject(details?.Error, "ChildContextError");
  }
  const update = (fields) => ({ ...ctx._base(rawId, meta), ...fields });
  // START can travel with the first child update. Nothing needs it saved first.
  if (!record) execution.checkpoint(update({ Action: "START" }));

  let result;
  try {
    result = await fn({ ctx: ctx._child(rawId, replayChildren) });
  } catch (err) {
    const errorObject = toErrorObject(err);
    if (!replayChildren) {
      await execution.checkpoint(
        update({ Action: "FAIL", Error: errorObject }),
      );
    }
    throw fromErrorObject(errorObject, "ChildContextError");
  }
  const payload = JSON.stringify(result);
  // The context already succeeded. Rebuilding its result changes nothing on the service.
  if (replayChildren) return parse(payload);
  const large =
    payload !== undefined && Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES;
  await execution.checkpoint(
    update(
      large
        ? {
            Action: "SUCCEED",
            Payload: "",
            ContextOptions: { ReplayChildren: true },
          }
        : { Action: "SUCCEED", Payload: payload },
    ),
  );
  return parse(payload);
}
