// Replay table for child contexts (Type CONTEXT, SubType RunInChildContext or the
// caller's subType, or the fixed SubType of waitForCallback, map and parallel):
//
// | Record status                  | Behavior                                          |
// |--------------------------------|---------------------------------------------------|
// | none                           | send START (not awaited), run fn, SUCCEED or FAIL |
// | STARTED                        | run fn again, children replay from their records  |
// | SUCCEEDED                      | return JSON.parse(Result) or deserialize, no fn  |
// | SUCCEEDED with ReplayChildren  | run fn again in a replay-only ctx, no checkpoint  |
// | FAILED                         | throw fromErrorObject(ContextDetails.Error), no fn |
//
// The service prunes the children of a completed context. So fn must not run again
// unless ReplayChildren kept them: its steps would run a second time.
//
// A custom serdes makes the SUCCEED Payload. The 256 KiB check applies to that string.
// A ReplayChildren re-run returns fn's value and calls no serdes. The full SDK sends
// that value through serialize and deserialize again.

import { fromErrorObject, toErrorObject } from "../errors.js";
import { CUSTOM_PAYLOAD } from "../execution.js";
import { deserialize, serialize } from "../serdes.js";

// The service limits one checkpoint payload. A larger result is rebuilt on replay.
const MAX_PAYLOAD_BYTES = 256 * 1024;
const parse = (s) => (s == null || s === "" ? undefined : JSON.parse(s));

// Internal: map and parallel use it with their own subType.
export function childContext(ctx, opts) {
  // The id is taken now, before any await (AGENTS.md 2.4).
  return runChild(ctx, ctx._nextId(), opts);
}

// Like the full SDK, an empty subType selects the default.
export function runInChildContext(ctx, { name, fn, subType, serdes }) {
  return childContext(ctx, {
    name,
    fn,
    subType: subType || "RunInChildContext",
    serdes,
  });
}

// keepChildren: always save summary(result) with ReplayChildren, whatever the size.
// A map or parallel with itemSerdes uses it (batch.js).
// waitForCallback calls this directly, because it needs the raw id.
export async function runChild(
  ctx,
  rawId,
  { name, fn, subType, summary, serdes, keepChildren },
) {
  const meta = { type: "CONTEXT", subType, name };
  const record = ctx._lookup(rawId);
  if (!ctx._mayRun(record, meta)) return new Promise(() => {});
  const details = record?.ContextDetails;
  const replayChildren = record?.Status === "SUCCEEDED";
  if (replayChildren && !details?.ReplayChildren) {
    const data = details?.Result;
    return serdes ? deserialize(ctx, serdes, data, rawId) : parse(data);
  }
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
  let payload;
  if (!keepChildren) {
    payload = serdes
      ? await serialize(ctx, serdes, result, rawId)
      : JSON.stringify(result);
  }
  const large =
    keepChildren ||
    (payload !== undefined && Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES);
  // summary: map and parallel save what a re-run needs to rebuild the same result.
  await child._checkpoint(
    update(
      large
        ? {
            Action: "SUCCEED",
            Payload: summary?.(result) ?? "",
            ContextOptions: { ReplayChildren: true },
          }
        : serdes
          ? { Action: "SUCCEED", Payload: payload, [CUSTOM_PAYLOAD]: true }
          : { Action: "SUCCEED", Payload: payload },
    ),
  );
  // The first run returns fn's own value. Only a replay parses the stored JSON or
  // calls deserialize (AGENTS.md 2.6).
  return result;
}
