import { nonDeterministicError } from "./errors.js";
import { hashId } from "./ids.js";
import { createLogger } from "./logger.js";
import { map, parallel } from "./operations/batch.js";
import { createCallback } from "./operations/callback.js";
import { runInChildContext } from "./operations/child-context.js";
import { invoke } from "./operations/invoke.js";
import { step } from "./operations/step.js";
import { wait } from "./operations/wait.js";
import { waitForCallback } from "./operations/wait-for-callback.js";
import { waitForCondition } from "./operations/wait-for-condition.js";

const never = () => new Promise(() => {});

// Members that start with "_" are for operations, not for user code.
// replayOnly: no operation may act that has no record (see _mayRun).
// parent: the enclosing ctx. Abandonment (see _abandoned) is read through it.
export function createContext({
  execution,
  prefix,
  parentId,
  replayOnly = false,
  parent,
}) {
  let counter = 0;
  let childrenAbandoned = false;
  const ctx = {
    _execution: execution,
    _replayOnly: replayOnly,
    // The record of this child context. Only child contexts call it.
    _record: () => execution.get(hashId(prefix)),

    // A batch that completes early abandons its items that are still running
    // (AGENTS.md 2.9). The batch sets the flag after the item ctxs exist. So the getter
    // reads the flag of every ancestor at each call.
    get _abandoned() {
      return (
        parent !== undefined && (parent._childrenAbandoned || parent._abandoned)
      );
    },
    get _childrenAbandoned() {
      return childrenAbandoned;
    },
    _abandonChildren() {
      childrenAbandoned = true;
    },

    // Every operation sends its updates through this method. An abandoned operation's
    // update would reach the service after its batch context completed. So the update is
    // not sent, and the promise never resolves.
    _checkpoint: (update) =>
      ctx._abandoned ? never() : execution.checkpoint(update),

    // The liveness check is read at each suspension check. So an operation that was
    // blocked before its batch abandoned it stops counting as blocked.
    _block: () => execution.block(() => !ctx._abandoned),

    // The EXECUTION record is always present. More records mean an earlier invocation ran.
    // A child starts replaying if its own record exists.
    replaying:
      prefix === undefined
        ? execution.size > 1
        : execution.get(hashId(prefix)) !== undefined,

    // Ids are allocated at call time, before any await, so concurrent calls stay
    // deterministic. A batch re-run also calls it alone to skip an item it does not run.
    _nextId() {
      counter++;
      const rawId =
        prefix === undefined ? String(counter) : `${prefix}-${counter}`;
      ctx.replaying = execution.get(hashId(rawId)) !== undefined;
      return rawId;
    },

    _lookup: (rawId) => execution.get(hashId(rawId)),

    // The ctx for the child context with this raw id. It lives here because
    // child-context.js is imported by this file: importing createContext back would
    // make an import cycle. A replay-only parent makes every descendant replay-only.
    _child: (rawId, childReplayOnly = false) =>
      createContext({
        execution,
        prefix: rawId,
        parentId: rawId,
        replayOnly: replayOnly || childReplayOnly,
        parent: ctx,
      }),

    // Every operation calls this after its lookup. False means the operation must stop:
    // it then returns a promise that never resolves.
    _mayRun(record, meta) {
      // Nothing awaits an abandoned operation, so it does not count as blocked.
      if (ctx._abandoned) return false;
      // A replay-only ctx re-runs a context that already succeeded (AGENTS.md 2.9).
      // Its fn awaited only operations that ended. So an operation without a record, or
      // a step or context that did not end, belongs to a branch that lost a race.
      // Running it would repeat or add side effects. Not counting it as blocked is safe,
      // because nothing that the result depends on awaits it.
      if (!record) return !replayOnly;
      if (!ctx._validateReplay(record, meta)) return false;
      return !(
        replayOnly &&
        (record.Type === "STEP" || record.Type === "CONTEXT") &&
        record.Status !== "SUCCEEDED" &&
        record.Status !== "FAILED"
      );
    },

    // The fields every update for this operation carries.
    _base(rawId, { type, subType, name }) {
      return {
        Id: hashId(rawId),
        ...(parentId !== undefined && { ParentId: hashId(parentId) }),
        ...(name !== undefined && { Name: name }),
        Type: type,
        ...(subType !== undefined && { SubType: subType }),
      };
    },

    // A record that does not match the call means the code changed between invocations.
    // Returns false after it ends the execution as FAILED.
    _validateReplay(record, { type, name, subType }) {
      if (
        record.Type === type &&
        record.Name === name &&
        record.SubType === subType
      ) {
        return true;
      }
      execution.fail(
        nonDeterministicError(
          `Operation ${record.Id} was ${record.Type}/${record.SubType} "${record.Name}" ` +
            `but the code called ${type}/${subType} "${name}"`,
        ),
      );
      return false;
    },

    step: (opts) => step(ctx, opts),
    wait: (opts) => wait(ctx, opts),
    createCallback: (opts) => createCallback(ctx, opts),
    invoke: (opts) => invoke(ctx, opts),
    runInChildContext: (opts) => runInChildContext(ctx, opts),
    waitForCallback: (opts) => waitForCallback(ctx, opts),
    waitForCondition: (opts) => waitForCondition(ctx, opts),
    map: (opts) => map(ctx, opts),
    parallel: (opts) => parallel(ctx, opts),
  };
  ctx.logger = createLogger(() => ctx.replaying);
  return ctx;
}
