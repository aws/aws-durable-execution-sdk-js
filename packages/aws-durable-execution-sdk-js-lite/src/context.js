import { nonDeterministicError } from "./errors.js";
import { hashId } from "./ids.js";
import { createLogger } from "./logger.js";
import { createCallback } from "./operations/callback.js";
import { invoke } from "./operations/invoke.js";
import { step } from "./operations/step.js";
import { wait } from "./operations/wait.js";

// Members that start with "_" are for operations, not for user code.
export function createContext({ execution, prefix, parentId }) {
  let counter = 0;
  const ctx = {
    _execution: execution,
    // The EXECUTION record is always present. More records mean an earlier invocation ran.
    // A child starts replaying if its own record exists.
    replaying:
      prefix === undefined
        ? execution.size > 1
        : execution.get(hashId(prefix)) !== undefined,

    // Ids are allocated at call time, before any await, so concurrent calls stay
    // deterministic.
    _nextId() {
      counter++;
      const rawId =
        prefix === undefined ? String(counter) : `${prefix}-${counter}`;
      ctx.replaying = execution.get(hashId(rawId)) !== undefined;
      return rawId;
    },

    _lookup: (rawId) => execution.get(hashId(rawId)),

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
  };
  ctx.logger = createLogger(() => ctx.replaying);
  return ctx;
}
