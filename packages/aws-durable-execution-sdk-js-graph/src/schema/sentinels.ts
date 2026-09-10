/**
 * Sentinel node names marking a graph's entry and exit, mirroring LangGraph's `START`/`END`.
 *
 * These are ordinary strings (not `Symbol`s) so they survive JSON serialisation into
 * checkpointed frontier records unchanged. They use a `__` prefix so they cannot collide with
 * a user's node name under normal naming conventions; the builder additionally rejects user
 * nodes named with these values.
 */

/** The virtual source node. Edges from `START` define the graph's entry point(s). */
export const START = "__start__";

/** The virtual sink node. Edges to `END` mark a node as terminal. */
export const END = "__end__";

/** Union of the sentinel literals, for precise typing of edge endpoints. */
export type Sentinel = typeof START | typeof END;
