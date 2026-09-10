import { ChannelMap, StateOf, StateSchema } from "../schema";
import { NodeFn, RouterFn } from "./node";

/**
 * A conditional edge: a router plus the set of nodes it may legally return. The `ends` set is
 * declared up front (as in LangGraph's `addConditionalEdges(source, router, ends)`) so the
 * builder can validate reachability without executing the router.
 */
export interface ConditionalEdge<C extends ChannelMap> {
  router: RouterFn<C>;
  /** The full set of possible destinations, used for static reachability validation. */
  ends: string[];
}

/**
 * The compiled, immutable graph the superstep driver executes. Produced by
 * {@link StateGraph.compile}. Everything the driver needs to run and to attest replay lives
 * here; the driver holds no other graph state.
 *
 * `orderFrontier` and `route` are **pure** and are the load-bearing determinism points
 * (brief invariants 3, 6): the driver checkpoints their output per tick and re-derives it on
 * replay to detect drift (§5.4).
 */
export interface GraphDef<C extends ChannelMap> {
  /** Human-readable graph name; also the name of the root child context. */
  readonly name: string;
  /** The state schema (channels + reducers). */
  readonly schema: StateSchema<C>;
  /** Node bodies keyed by node name. */
  readonly nodes: Readonly<Record<string, NodeFn<C>>>;
  /** The initial frontier: the node names reachable from `START`. */
  readonly entry: string[];
  /** Max branches to run concurrently within a superstep. */
  readonly maxConcurrency: number;

  /**
   * Deterministically order a frontier. Sorting node names makes ordering reproducible, which
   * matters because positional identity makes ordering load-bearing (brief invariant 6). Pure.
   */
  orderFrontier(frontier: string[]): string[];

  /**
   * Compute the next frontier from the just-executed nodes and the current (checkpointed)
   * state. Returns the deduplicated, unordered set of successor node names, with `END`
   * filtered out. Pure — reads only `state`.
   */
  route(active: string[], state: Readonly<StateOf<C>>): string[];
}
