// Replay table for map and parallel (Type CONTEXT, SubType Map or Parallel):
//
// The batch is a child context whose children are one child context per item
// (SubType MapIteration or ParallelBranch). The child context replay table applies
// (child-context.js) at both levels:
//
// | Batch record                   | Behavior                                          |
// |--------------------------------|---------------------------------------------------|
// | none or STARTED                | run the items; finished items replay their record |
// | SUCCEEDED                      | rebuild the BatchResult from the stored JSON      |
// | SUCCEEDED with ReplayChildren  | run the items again; all replay from their record |
//
// Every item runs to completion (AGENTS.md 1.6: no early completion). So the batch never
// finishes while an item is still open, and a re-run always sees the same items.

import { fromErrorObject, toErrorObject } from "../errors.js";
import { childContext } from "./child-context.js";

export function map(ctx, { name, items, fn, maxConcurrency, itemName }) {
  const tasks = items.map((item, index) => ({
    name: itemName?.({ item, index }),
    fn: ({ ctx: c }) => fn({ ctx: c, item, index }),
  }));
  return batch(ctx, { name, subType: "Map", tasks, maxConcurrency });
}

export function parallel(ctx, { name, branches, maxConcurrency }) {
  return batch(ctx, {
    name,
    subType: "Parallel",
    tasks: branches,
    maxConcurrency,
  });
}

const ITEM_SUBTYPE = { Map: "MapIteration", Parallel: "ParallelBranch" };

async function batch(ctx, { name, subType, tasks, maxConcurrency = Infinity }) {
  const value = await childContext(ctx, {
    name,
    subType,
    fn: ({ ctx: b }) => runAll(b, tasks, ITEM_SUBTYPE[subType], maxConcurrency),
  });
  return toBatchResult(value);
}

// Items start strictly in index order, and childContext takes its id at call time. So
// item i always gets the raw id `${batchId}-${i + 1}`, in every invocation.
function runAll(ctx, tasks, subType, maxConcurrency) {
  const all = [];
  let started = 0;
  let settled = 0;
  return new Promise((resolve) => {
    const startMore = () => {
      if (settled === tasks.length) {
        resolve({ all, completionReason: "ALL_COMPLETED" });
      }
      while (started < tasks.length && started - settled < maxConcurrency) {
        const index = started++;
        const { name, fn } = tasks[index];
        // A failed item is recorded, not thrown. The other items keep running. The chain
        // never rejects, so nothing awaits it.
        void childContext(ctx, { name, subType, fn })
          .then(
            (result) => ({ index, status: "SUCCEEDED", result }),
            (err) => ({ index, status: "FAILED", error: toErrorObject(err) }),
          )
          .then((item) => {
            all[index] = item;
            settled++;
            startMore();
          });
      }
    };
    startMore();
  });
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
