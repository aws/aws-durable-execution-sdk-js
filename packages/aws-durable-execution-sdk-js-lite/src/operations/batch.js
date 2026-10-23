// Replay table for map and parallel (Type CONTEXT, SubType Map or Parallel):
//
// The batch is a child context whose children are one child context per item
// (SubType MapIteration or ParallelBranch). The child context replay table applies
// (child-context.js) at both levels:
//
// | Batch record                   | Behavior                                          |
// |--------------------------------|---------------------------------------------------|
// | none or STARTED                | run the scheduler; finished items replay          |
// | SUCCEEDED                      | rebuild the BatchResult from the stored JSON      |
// | SUCCEEDED with ReplayChildren  | re-drive the items the saved statuses mark S or F |
//
// The batch can complete before every item finished (completionConfig). It then
// abandons the items that still run: they send no more updates (AGENTS.md 2.9).

import { fromErrorObject, toErrorObject } from "../errors.js";
import { childContext } from "./child-context.js";

export function map(
  ctx,
  { name, items, fn, maxConcurrency, itemName, completionConfig },
) {
  const tasks = items.map((item, index) => ({
    name: itemName?.({ item, index }),
    fn: ({ ctx: c }) => fn({ ctx: c, item, index }),
  }));
  return batch(ctx, {
    name,
    subType: "Map",
    tasks,
    maxConcurrency,
    completionConfig,
  });
}

export function parallel(
  ctx,
  { name, branches, maxConcurrency, completionConfig },
) {
  return batch(ctx, {
    name,
    subType: "Parallel",
    tasks: branches,
    maxConcurrency,
    completionConfig,
  });
}

const ITEM_SUBTYPE = { Map: "MapIteration", Parallel: "ParallelBranch" };
const MARK = { SUCCEEDED: "S", FAILED: "F", STARTED: "-" };

async function batch(ctx, { name, subType, tasks, ...config }) {
  const itemSubType = ITEM_SUBTYPE[subType];
  const value = await childContext(ctx, {
    name,
    subType,
    // A replay-only batch ctx means the batch record is SUCCEEDED with ReplayChildren.
    // Every other record either returns before fn runs or makes the ctx not replay-only.
    fn: ({ ctx: b }) =>
      b._replayOnly
        ? replayAll(b, tasks, itemSubType)
        : runAll(b, tasks, itemSubType, config),
    // One character per started item, in index order, like the full SDK's itemStatuses.
    summary: ({ all, completionReason }) =>
      JSON.stringify({
        completionReason,
        itemStatuses: all.map((i) => MARK[i.status]).join(""),
      }),
  });
  return toBatchResult(value);
}

// The rules of the full SDK (concurrent-execution-handler.ts, shouldContinue,
// isComplete and getCompletionReason). With no threshold set, one failure exceeds the
// tolerance (fail fast).
function completionPolicy(config, total) {
  const { minSuccessful, toleratedFailureCount, toleratedFailurePercentage } =
    config ?? {};
  const thresholds =
    config !== undefined && Object.values(config).some((v) => v !== undefined);
  const exceeded = (failed) =>
    thresholds
      ? (toleratedFailureCount !== undefined &&
          failed > toleratedFailureCount) ||
        (toleratedFailurePercentage !== undefined &&
          (failed / total) * 100 > toleratedFailurePercentage)
      : failed > 0;
  const enough = (succeeded) =>
    minSuccessful !== undefined && succeeded >= minSuccessful;
  return {
    exceeded,
    done: (s, f) => s + f === total || enough(s) || exceeded(f),
    reason(s, f) {
      if (exceeded(f)) return "FAILURE_TOLERANCE_EXCEEDED";
      if (s + f === total) return "ALL_COMPLETED";
      return enough(s) ? "MIN_SUCCESSFUL_REACHED" : "ALL_COMPLETED";
    },
  };
}

// A failed item is recorded, not thrown. The chain never rejects.
const settle = (promise, index) =>
  promise.then(
    (result) => ({ index, status: "SUCCEEDED", result }),
    (err) => ({ index, status: "FAILED", error: toErrorObject(err) }),
  );

// Items start strictly in index order, and childContext takes its id at call time. So
// item i always gets the raw id `${batchId}-${i + 1}`, and the started items are always
// the first `all.length` items.
function runAll(
  ctx,
  tasks,
  subType,
  { maxConcurrency = Infinity, completionConfig },
) {
  const policy = completionPolicy(completionConfig, tasks.length);
  const all = [];
  let succeeded = 0;
  let failed = 0;
  let decided = false;
  return new Promise((resolve) => {
    const decide = () => {
      decided = true;
      // Items still running would send updates under the completed batch context.
      ctx._abandonChildren();
      resolve({ all, completionReason: policy.reason(succeeded, failed) });
    };
    const startMore = () => {
      while (
        all.length < tasks.length &&
        all.length - succeeded - failed < maxConcurrency &&
        !policy.exceeded(failed)
      ) {
        const index = all.length;
        all.push({ index, status: "STARTED" });
        const { name, fn } = tasks[index];
        void settle(childContext(ctx, { name, subType, fn }), index).then(
          (item) => {
            // An item that settles after the decision keeps STARTED, like the full SDK.
            if (decided) return;
            all[index] = item;
            if (item.status === "SUCCEEDED") succeeded++;
            else failed++;
            if (policy.done(succeeded, failed)) decide();
            else startMore();
          },
        );
      }
    };
    startMore();
    // No item started: the batch is empty, or the tolerance is below zero failures.
    if (all.length === 0) decide();
  });
}

// A ReplayChildren re-run. Cached items settle in a different order than in the live
// run. So the scheduler could decide differently. So the statuses that the live run
// saved decide instead:
// 1. An item marked S or F is re-driven in index order. It replays from its record.
// 2. An item marked "-" was still running. It is not run. Its id is still taken, so
//    later items keep their ids. It stays STARTED in the result.
// 3. An item after the marks never started. It is not run and not in the result.
async function replayAll(ctx, tasks, subType) {
  const { completionReason, itemStatuses } = JSON.parse(
    ctx._record().ContextDetails.Result,
  );
  const all = [];
  for (const [index, mark] of [...itemStatuses].entries()) {
    if (mark === "-") {
      ctx._nextId();
      all.push({ index, status: "STARTED" });
    } else {
      const { name, fn } = tasks[index];
      all.push(await settle(childContext(ctx, { name, subType, fn }), index));
    }
  }
  return { all, completionReason };
}

// The stored JSON holds ErrorObjects. Both the first run and a replay build the result
// from that JSON, so both behave the same.
function toBatchResult({ all, completionReason }) {
  const items = all.map((item) =>
    item.error
      ? { ...item, error: fromErrorObject(item.error, "ChildContextError") }
      : item,
  );
  const getErrors = () =>
    items.filter((i) => i.status === "FAILED").map((i) => i.error);
  return {
    all: items,
    completionReason,
    getResults: () =>
      items.filter((i) => i.status === "SUCCEEDED").map((i) => i.result),
    getErrors,
    throwIfError() {
      const [first] = getErrors();
      if (first) throw first;
    },
  };
}
