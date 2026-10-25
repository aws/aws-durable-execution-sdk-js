// Replay table for waitForCondition (Type STEP, SubType WaitForCondition):
//
// | Record status         | Behavior                                                  |
// |-----------------------|-----------------------------------------------------------|
// | none or READY         | send START (not awaited), run one check                   |
// | STARTED               | run one check, no new START                               |
// | SUCCEEDED             | return JSON.parse(StepDetails.Result), or deserialize     |
// | FAILED                | throw fromErrorObject(StepDetails.Error)                  |
// | PENDING               | block until the service makes it READY                    |
//
// A check runs fn on the saved state (StepDetails.Result, else initialState), then asks
// waitStrategy. Stop sends SUCCEED. Continue sends RETRY with the new state as Payload,
// so the service keeps the state between attempts, then blocks. A blocked check wakes
// when a checkpoint response changes its record (README 2.5), normally to READY. It
// then applies this table to the new record. A throw sends FAIL with no retry. Unlike
// the full SDK, replay is validated.
//
// A custom serdes makes every state Payload, and reads the saved state back. The first
// check gets initialState itself, and the first run returns fn's own state. The full SDK
// sends both through serialize and deserialize first (README 2.6).

import { fromErrorObject, toErrorObject } from "../errors.js";
import { CUSTOM_PAYLOAD } from "../execution.js";
import { createLogger } from "../logger.js";
import { wrapInfo } from "../plugins.js";
import { deserialize, serialize } from "../serdes.js";

const parse = (s) => (s == null ? undefined : JSON.parse(s));
// A finished check does not run again, so its logs are never duplicates.
const checkLogger = createLogger();

export function waitForCondition(ctx, opts) {
  // The id is taken now, before any await (README 2.4).
  return runCondition(ctx, ctx._nextId(), opts);
}

async function runCondition(
  ctx,
  rawId,
  { name, fn, initialState, waitStrategy, serdes },
) {
  const execution = ctx._execution;
  const meta = { type: "STEP", subType: "WaitForCondition", name };
  if (!ctx._mayRun(ctx._lookup(rawId), meta)) return new Promise(() => {});
  const update = (fields) => ({ ...ctx._base(rawId, meta), ...fields });
  // The block of a PENDING check resolves when a checkpoint response changes the
  // record, normally to READY. The loop then applies the replay table to the new record.
  for (;;) {
    const record = ctx._lookup(rawId);
    const status = record?.Status;
    const details = record?.StepDetails;

    if (status === "SUCCEEDED") {
      const data = details?.Result;
      return serdes ? deserialize(ctx, serdes, data, rawId) : parse(data);
    }
    if (status === "FAILED") {
      throw fromErrorObject(details?.Error, "WaitForConditionError");
    }
    if (status === "PENDING") {
      await ctx._block(rawId);
      continue;
    }

    // A later check reads the state that the previous check saved.
    let state = initialState;
    if (details?.Result != null) {
      if (serdes) {
        state = await deserialize(ctx, serdes, details.Result, rawId);
        // The invocation can end while deserialize runs. fn must not run then: nothing
        // would save its result. This is the same check as in step.js.
        if (execution.done || ctx._abandoned) return new Promise(() => {});
      } else state = JSON.parse(details.Result);
    }
    if (status !== "STARTED") ctx._checkpoint(update({ Action: "START" }));
    const attempt = (details?.Attempt ?? 0) + 1;

    let newState;
    let decision;
    let error;
    let failed = false;
    execution.runningStart();
    const wrap = execution.wrap;
    try {
      // Without a wrap hook, no closure is made (README 2.12).
      newState = await (wrap
        ? wrap(
            wrapInfo(ctx, rawId, meta, "attempt", attempt, () =>
              fn({ state, attempt, logger: checkLogger }),
            ),
          )
        : fn({ state, attempt, logger: checkLogger }));
      decision = waitStrategy({ state: newState, attempt });
    } catch (err) {
      failed = true;
      error = err;
    }
    // A custom serialize counts as running while it runs (serdes.js). It starts before
    // runningEnd, so the check counts as running without a gap.
    const serialized =
      serdes && !failed ? serialize(ctx, serdes, newState, rawId) : undefined;
    // The outcome checkpoint is queued in this same tick, or in the microtask after
    // serialize settles. So the execution never looks idle in between.
    execution.runningEnd();

    if (failed) {
      const errorObject = toErrorObject(error);
      await ctx._checkpoint(update({ Action: "FAIL", Error: errorObject }));
      throw fromErrorObject(errorObject, "WaitForConditionError");
    }
    const payload = serdes ? await serialized : JSON.stringify(newState);
    // Only a custom Payload carries the mark. A symbol key on every update slows the
    // default path.
    const mark = serdes && { [CUSTOM_PAYLOAD]: true };
    if (!decision.shouldContinue) {
      await ctx._checkpoint(
        update({ Action: "SUCCEED", Payload: payload, ...mark }),
      );
      // The first run returns fn's own value. Only a replay parses the stored JSON or
      // calls deserialize.
      return newState;
    }
    await ctx._checkpoint(
      update({
        Action: "RETRY",
        Payload: payload,
        ...mark,
        StepOptions: { NextAttemptDelaySeconds: decision.delaySeconds ?? 1 },
      }),
    );
    await ctx._block(rawId);
  }
}
