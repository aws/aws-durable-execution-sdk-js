import { Serdes, SerdesContext } from "@aws/durable-execution-sdk-js";

/**
 * Custom serdes that uppercases on serialize and returns as-is on deserialize.
 * This makes it trivial to detect whether a result went through ser/des:
 * - If the result is UPPERCASE, serialize ran and its output flowed back through
 *   deserialize (the full round-trip was applied).
 * - If the result is lowercase, the raw in-memory value was returned without
 *   the round-trip.
 *
 * Shared by the small-payload, large-payload, and virtual-context
 * run-in-child-context serdes examples so all three modes assert identical
 * round-trip behavior.
 *
 * This lives under examples/shared/ (which the example catalog scanner skips)
 * and exports no `handler`/`config`, so it is NOT a catalog example. rollup
 * therefore folds it into the shared `vendors` chunk that is packaged with
 * every handler, rather than emitting a cross-example import to a sibling
 * handler bundle that wouldn't be deployed alongside it.
 */
export const uppercaseSerdes: Serdes<string> = {
  serialize: async (value: string | undefined, _context: SerdesContext) => {
    if (value === undefined) return undefined;
    return value.toUpperCase();
  },
  deserialize: async (data: string | undefined, _context: SerdesContext) => {
    return data;
  },
};
