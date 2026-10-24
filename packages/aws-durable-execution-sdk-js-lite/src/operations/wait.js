// Replay table for wait (Type WAIT, SubType Wait):
//
// | Record status                    | Behavior                                         |
// |----------------------------------|--------------------------------------------------|
// | none                             | send START with WaitOptions.WaitSeconds, block   |
// | SUCCEEDED                        | resolve                                          |
// | FAILED, CANCELLED, STOPPED, ...  | resolve, like the full SDK                       |
// | STARTED or anything else         | block until the service ends the wait            |
//
// The service completes the wait at its scheduled time. The SDK never sends SUCCEED.
// A blocked wait wakes when a checkpoint response changes its record (README 2.5).
// It then applies this table to the new record.

const TERMINAL = new Set([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "STOPPED",
  "TIMED_OUT",
]);

export function wait(ctx, opts) {
  // The id is taken now, before any await (README 2.4).
  return runWait(ctx, ctx._nextId(), opts);
}

async function runWait(ctx, rawId, { name, seconds }) {
  const meta = { type: "WAIT", subType: "Wait", name };
  const record = ctx._lookup(rawId);
  if (!ctx._mayRun(record, meta)) return new Promise(() => {});
  if (!record) {
    await ctx._checkpoint({
      ...ctx._base(rawId, meta),
      Action: "START",
      WaitOptions: { WaitSeconds: seconds },
    });
  }
  // Without timers the SDK cannot end the wait itself. A changed record wakes the block.
  while (!TERMINAL.has(ctx._lookup(rawId)?.Status)) await ctx._block(rawId);
}
