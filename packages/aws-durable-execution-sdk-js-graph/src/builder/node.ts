import { DurableContext } from "@aws/durable-execution-sdk-js";
import { ChannelMap, DeltaOf, StateOf } from "../schema";

/**
 * The context object a node body receives, in addition to the current state. It carries the
 * node's own {@link DurableContext} (so the node may call `ctx.step`, `ctx.waitForCallback`,
 * etc. — the source of sub-superstep granularity, design doc §4.4) plus the resume value from
 * a prior interrupt, if any.
 *
 * @typeParam C - The graph's channel map.
 */
export interface NodeContext {
  /**
   * A real durable context for this node. Nodes run as `parallel` branches, which each get a
   * fresh context, so calling `ctx.step(...)` here does NOT nest a step inside a step
   * (brief invariant 2).
   */
  ctx: DurableContext;
  /**
   * The value delivered by resuming a prior interrupt, or `undefined` when the node is not
   * being entered via a resume. Present for parity with LangGraph's `Command({ resume })`.
   * In the POC's `waitForCallback` model the resume value is delivered directly by the
   * callback, so this is informational; see POC_FINDINGS.md.
   */
  resume: unknown;
}

/**
 * A node body. Receives the current (read-only) state and a {@link NodeContext}, and returns a
 * state delta — a partial map of channel updates — or `void`/`undefined` for "no change".
 *
 * The delta is folded through the schema's reducers *outside* any step (design doc §4.4), so
 * the node's own logic may be non-deterministic only inside `ctx.step(...)`.
 *
 * @typeParam C - The graph's channel map.
 */
export type NodeFn<C extends ChannelMap> = (
  state: Readonly<StateOf<C>>,
  nodeCtx: NodeContext,
) => Promise<DeltaOf<C> | undefined> | DeltaOf<C> | undefined;

/**
 * A conditional-edge router: a *pure* function of checkpointed state returning the name(s) of
 * the next node(s), or {@link END}. Design doc §4.4/§5.5: routing MUST read only checkpointed
 * state — no live model calls, clock reads, or RNG. A decision that needs a model call must
 * make that call inside a node and write the result into the state delta so the router can
 * read it back.
 *
 * @typeParam C - The graph's channel map.
 */
export type RouterFn<C extends ChannelMap> = (
  state: Readonly<StateOf<C>>,
) => string | string[];
