// Replay table for waitForCondition (Type STEP, SubType WaitForCondition):
//
// | Record status         | Behavior                                                  |
// |-----------------------|-----------------------------------------------------------|
// | none or READY         | send START (not awaited), run one check                   |
// | STARTED               | run one check, no new START                               |
// | SUCCEEDED             | return JSON.parse(StepDetails.Result)                     |
// | FAILED                | throw fromErrorObject(StepDetails.Error)                  |
// | PENDING               | block until the service makes it READY                    |
//
// A check runs fn on the saved state (StepDetails.Result, else initialState), then asks
// waitStrategy. Stop sends SUCCEED. Continue sends RETRY with the new state as Payload,
// so the service keeps the state between attempts, then blocks. A throw sends FAIL with
// no retry. Unlike the full SDK, replay is validated.

import { fromErrorObject, toErrorObject } from "../errors.js";
import { createLogger } from "../logger.js";

const parse = (s) => (s == null ? undefined : JSON.parse(s));
// A finished check does not run again, so its logs are never duplicates.
const checkLogger = createLogger();

export function waitForCondition(ctx, opts) {
  // The id is taken now, before any await (AGENTS.md 2.4).
  return runCondition(ctx, ctx._nextId(), opts);
}

async function runCondition(
  ctx,
  rawId,
  { name, fn, initialState, waitStrategy },
) {
  const execution = ctx._execution;
  const meta = { type: "STEP", subType: "WaitForCondition", name };
  const record = ctx._lookup(rawId);
  if (!ctx._mayRun(record, meta)) return new Promise(() => {});
  const update = (fields) => ({ ...ctx._base(rawId, meta), ...fields });
  const status = record?.Status;
  const details = record?.StepDetails;

  if (status === "SUCCEEDED") return parse(details?.Result);
  if (status === "FAILED") {
    throw fromErrorObject(details?.Error, "WaitForConditionError");
  }
  if (status === "PENDING") return ctx._block();

  // A later check reads the state that the previous check saved.
  const state =
    details?.Result != null ? JSON.parse(details.Result) : initialState;
  if (status !== "STARTED") ctx._checkpoint(update({ Action: "START" }));
  const attempt = (details?.Attempt ?? 0) + 1;

  let newState;
  let decision;
  let error;
  let failed = false;
  execution.runningStart();
  try {
    newState = await fn({ state, attempt, logger: checkLogger });
    decision = waitStrategy({ state: newState, attempt });
  } catch (err) {
    failed = true;
    error = err;
  } finally {
    // The outcome checkpoint is queued in this same tick, so the execution never
    // looks idle in between.
    execution.runningEnd();
  }

  if (failed) {
    const errorObject = toErrorObject(error);
    await ctx._checkpoint(update({ Action: "FAIL", Error: errorObject }));
    throw fromErrorObject(errorObject, "WaitForConditionError");
  }
  const payload = JSON.stringify(newState);
  if (!decision.shouldContinue) {
    await ctx._checkpoint(update({ Action: "SUCCEED", Payload: payload }));
    // The first run returns fn's own value. Only a replay parses the stored JSON.
    return newState;
  }
  await ctx._checkpoint(
    update({
      Action: "RETRY",
      Payload: payload,
      StepOptions: { NextAttemptDelaySeconds: decision.delaySeconds ?? 1 },
    }),
  );
  return ctx._block();
}
