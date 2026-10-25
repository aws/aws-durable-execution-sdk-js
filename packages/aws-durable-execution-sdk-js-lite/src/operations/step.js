// Replay table for step (Type STEP, SubType Step or the caller's subType):
//
// | Record status               | Behavior                                              |
// |-----------------------------|-------------------------------------------------------|
// | none or READY               | send START, run fn                                    |
// | SUCCEEDED                   | return JSON.parse(StepDetails.Result), or deserialize |
// | FAILED                      | throw fromErrorObject(StepDetails.Error)              |
// | PENDING (retry scheduled)   | block until the service makes it READY                |
// | STARTED, at-least-once      | run fn again, no new START                            |
// | STARTED, at-most-once       | the last run was interrupted: retry decision, no fn   |
//
// After fn: success sends SUCCEED. Failure asks retryStrategy, then sends FAIL and
// throws, or sends RETRY and blocks. A blocked step wakes when a checkpoint response
// changes its record (README 2.5), normally to READY. It then applies this table to
// the new record. So the next attempt can run in the same invocation. A custom serdes
// makes the SUCCEED Payload. The first run does not call deserialize (README 2.6).

import { fromErrorObject, toErrorObject } from "../errors.js";
import { CUSTOM_PAYLOAD } from "../execution.js";
import { createLogger } from "../logger.js";
import { wrapInfo } from "../plugins.js";
import { defaultRetryStrategy } from "../retry.js";
import { deserialize, serialize } from "../serdes.js";

const AT_MOST_ONCE = "AT_MOST_ONCE_PER_RETRY";
const parse = (s) => (s == null ? undefined : JSON.parse(s));
// A completed step does not run again, so its logs are never duplicates.
const stepLogger = createLogger();

export function step(ctx, opts) {
  // The id is taken now, before any await (README 2.4).
  return runStep(ctx, ctx._nextId(), opts);
}

async function runStep(
  ctx,
  rawId,
  {
    name,
    fn,
    retryStrategy = defaultRetryStrategy,
    semantics = "AT_LEAST_ONCE_PER_RETRY",
    subType,
    serdes,
  },
) {
  const execution = ctx._execution;
  // Like the full SDK, an empty subType selects the default.
  const meta = { type: "STEP", subType: subType || "Step", name };
  if (!ctx._mayRun(ctx._lookup(rawId), meta)) return new Promise(() => {});
  const update = (fields) => ({ ...ctx._base(rawId, meta), ...fields });
  // At-least-once does not wait for the outcome checkpoint. The queue keeps the order of
  // updates, and the invocation does not end before the queue is empty. If the invocation
  // ends before the request succeeds, the step runs again, which at-least-once allows.
  // At-most-once waits, so its outcome is saved before later code runs.
  const saved = (u) => {
    const p = ctx._checkpoint(u);
    return semantics === AT_MOST_ONCE ? p : undefined;
  };
  // The block of a PENDING retry resolves when a checkpoint response changes the
  // record, normally to READY. The loop then applies the replay table to the new record.
  for (;;) {
    const record = ctx._lookup(rawId);
    const status = record?.Status;

    if (status === "SUCCEEDED") {
      const data = record.StepDetails?.Result;
      return serdes ? deserialize(ctx, serdes, data, rawId) : parse(data);
    }
    if (status === "FAILED") {
      throw fromErrorObject(record.StepDetails?.Error, "StepError");
    }
    if (status === "PENDING") {
      await ctx._block(rawId);
      continue;
    }

    // The service counts finished attempts in StepDetails.Attempt (0-based). The full SDK
    // passes Attempt + 1 to fn and to the retry strategy.
    const attempt = (record?.StepDetails?.Attempt ?? 0) + 1;
    let error;
    if (status === "STARTED" && semantics === AT_MOST_ONCE) {
      // fn may have had side effects. Running it again would break at-most-once.
      error = new Error(
        "The step execution process was initiated but failed to reach completion due to an interruption.",
      );
      error.name = "StepInterruptedError";
    } else {
      if (status !== "STARTED") {
        const started = ctx._checkpoint(update({ Action: "START" }));
        // At-most-once must know the service recorded START before fn has side effects.
        // At-least-once lets START travel with later updates.
        if (semantics === AT_MOST_ONCE) await started;
      }
      // A step that did not wait for its outcome checkpoint lets later code run after the
      // invocation ended, for example in a warm sandbox's next invocation. Its fn must not
      // run then: nothing would save its result. An at-most-once step can also be abandoned
      // by its batch while it waits for START. Its fn must not run then either.
      if (execution.done || ctx._abandoned) return new Promise(() => {});
      let result;
      let failed = false;
      let serialized;
      execution.runningStart();
      const wrap = execution.wrap;
      try {
        // Without a wrap hook, no closure is made (README 2.12).
        result = await (wrap
          ? wrap(
              wrapInfo(ctx, rawId, meta, "attempt", attempt, () =>
                fn({ logger: stepLogger, attempt }),
              ),
            )
          : fn({ logger: stepLogger, attempt }));
      } catch (err) {
        failed = true;
        error = err;
      } finally {
        // A custom serialize counts as running while it runs (serdes.js). It starts
        // before runningEnd, so the step counts as running without a gap.
        if (serdes && !failed)
          serialized = serialize(ctx, serdes, result, rawId);
        // The outcome checkpoint below is queued in this same tick, or in the microtask
        // after serialize settles. So the execution never looks idle in between.
        execution.runningEnd();
      }
      if (!failed) {
        const payload = serdes ? await serialized : JSON.stringify(result);
        // Only a custom Payload carries the mark. A symbol key on every update made 3000
        // default steps about 3% slower.
        await saved(
          update(
            serdes
              ? { Action: "SUCCEED", Payload: payload, [CUSTOM_PAYLOAD]: true }
              : { Action: "SUCCEED", Payload: payload },
          ),
        );
        // The first run returns fn's own value. Only a replay parses the stored JSON or
        // calls deserialize (README 2.6).
        return result;
      }
    }

    const errorObject = toErrorObject(error);
    const decision = retryStrategy({ error, attempt });
    if (!decision.shouldRetry) {
      await saved(update({ Action: "FAIL", Error: errorObject }));
      throw fromErrorObject(errorObject, "StepError");
    }
    await ctx._checkpoint(
      update({
        Action: "RETRY",
        Error: errorObject,
        StepOptions: { NextAttemptDelaySeconds: decision.delaySeconds ?? 1 },
      }),
    );
    await ctx._block(rawId);
  }
}
