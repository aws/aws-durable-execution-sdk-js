// Replay table for step (Type STEP, SubType Step):
//
// | Record status               | Behavior                                              |
// |-----------------------------|-------------------------------------------------------|
// | none or READY               | send START, run fn                                    |
// | SUCCEEDED                   | return JSON.parse(StepDetails.Result)                 |
// | FAILED                      | throw fromErrorObject(StepDetails.Error)              |
// | PENDING (retry scheduled)   | block until the service makes it READY                |
// | STARTED, at-least-once      | run fn again, no new START                            |
// | STARTED, at-most-once       | the last run was interrupted: retry decision, no fn   |
//
// After fn: success sends SUCCEED. Failure asks retryStrategy, then sends FAIL and
// throws, or sends RETRY and blocks.

import { fromErrorObject, toErrorObject } from "../errors.js";
import { createLogger } from "../logger.js";
import { defaultRetryStrategy } from "../retry.js";

const AT_MOST_ONCE = "AT_MOST_ONCE_PER_RETRY";
const parse = (s) => (s == null ? undefined : JSON.parse(s));
// A completed step does not run again, so its logs are never duplicates.
const stepLogger = createLogger();

export function step(ctx, opts) {
  // The id is taken now, before any await (AGENTS.md 2.4).
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
  },
) {
  const execution = ctx._execution;
  const meta = { type: "STEP", subType: "Step", name };
  const record = ctx._lookup(rawId);
  if (record && !ctx._validateReplay(record, meta))
    return new Promise(() => {});
  const update = (fields) => ({ ...ctx._base(rawId, meta), ...fields });
  const status = record?.Status;

  if (status === "SUCCEEDED") return parse(record.StepDetails?.Result);
  if (status === "FAILED") {
    throw fromErrorObject(record.StepDetails?.Error, "StepError");
  }
  if (status === "PENDING") return execution.block();

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
      const started = execution.checkpoint(update({ Action: "START" }));
      // At-most-once must know the service recorded START before fn has side effects.
      // At-least-once lets START travel with later updates.
      if (semantics === AT_MOST_ONCE) await started;
    }
    let result;
    let failed = false;
    execution.runningStart();
    try {
      result = await fn({ logger: stepLogger, attempt });
    } catch (err) {
      failed = true;
      error = err;
    } finally {
      // The outcome checkpoint below is queued in this same tick, so the execution
      // never looks idle in between.
      execution.runningEnd();
    }
    if (!failed) {
      const payload = JSON.stringify(result);
      await execution.checkpoint(
        update({ Action: "SUCCEED", Payload: payload }),
      );
      return parse(payload);
    }
  }

  const errorObject = toErrorObject(error);
  const decision = retryStrategy({ error, attempt });
  if (!decision.shouldRetry) {
    await execution.checkpoint(update({ Action: "FAIL", Error: errorObject }));
    throw fromErrorObject(errorObject, "StepError");
  }
  await execution.checkpoint(
    update({
      Action: "RETRY",
      Error: errorObject,
      StepOptions: { NextAttemptDelaySeconds: decision.delaySeconds ?? 1 },
    }),
  );
  return execution.block();
}
