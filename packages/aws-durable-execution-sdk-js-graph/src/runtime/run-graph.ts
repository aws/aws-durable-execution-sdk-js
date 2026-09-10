import { DurableContext } from "@aws/durable-execution-sdk-js";
import { ChannelMap, DeltaOf, StateOf } from "../schema";
import { GraphDef } from "../builder";
import { NodeContext } from "../builder/node";
import { assertFrontierMatchesRecord } from "./frontier-attestation";
import { nodePath } from "../identity";

/**
 * A node's output paired with the node it came from. Nodes return this (not a bare delta) so
 * the fold can attribute each delta to its node *without* relying on `BatchResult.getResults()`
 * ordering — the brief warns `getResults()[i]` is not guaranteed to align with `active[i]`.
 */
interface NodeResult<C extends ChannelMap> {
  node: string;
  delta: DeltaOf<C> | undefined;
}

/**
 * The superstep driver (design doc §4.4). Takes a {@link DurableContext} rather than creating
 * one, which is what makes a graph *composable* — it can be one operation inside a larger
 * durable workflow (§4.3).
 *
 * Loop, per tick:
 *   1. Order the frontier deterministically (sorted node names).
 *   2. Attest the frontier against the checkpointed record → {@link GraphDriftError} on drift.
 *   3. Run every active node as a `parallel` branch (each gets a fresh context, so nodes may
 *      call `ctx.step` without nesting a step in a step).
 *   4. Fold the returned deltas through the schema reducers **outside** any step — pure and
 *      re-run on replay (§4.5), which is exactly what forces reducers to be pure.
 *   5. Route from the just-executed nodes and the new state to the next frontier.
 *
 * The whole thing runs inside a child context tagged `subType: "DurableGraph"` for
 * observability (§4.3), with per-tick contexts tagged `"GraphSuperstep"`.
 *
 * NOTE: the design doc's third tag, `"GraphNode"`, is **not applied** and cannot be, as of core
 * SDK v2.3.0. Nodes are dispatched as `parallel` branches, and `NamedParallelBranch` is only
 * `{ name?, func }` — it carries no subType. `ParallelConfig` also omits the
 * `topLevelSubType` / `iterationSubType` fields that the `@public` `ConcurrencyConfig` exposes,
 * so a `parallel` caller has no way to tag branches; they get the built-in `ParallelBranch`
 * subType. Nodes therefore carry their identity in the *name* only (the §6 fallback). See
 * POC_FINDINGS.md — this is a primitive-level gap, not a framework one.
 *
 * @typeParam C - The graph's channel map.
 * @param parent - The enclosing durable context.
 * @param graph - The compiled graph definition.
 * @param input - Initial input, folded into the schema's initial state.
 * @returns The final state after the frontier empties.
 */
export function runGraph<C extends ChannelMap>(
  parent: DurableContext,
  graph: GraphDef<C>,
  input: unknown,
): Promise<StateOf<C>> {
  return parent.runInChildContext<StateOf<C>>(
    graph.name,
    async (context) => {
      let state = graph.schema.init(input);
      let frontier = graph.orderFrontier(graph.entry);
      let resume: unknown;

      for (let tick = 0; frontier.length > 0; tick++) {
        const active = graph.orderFrontier(frontier);

        // Drift detection BEFORE dispatch (§5.4). On replay this throws if routing/topology
        // diverged from what was recorded, rather than silently re-executing.
        await assertFrontierMatchesRecord(context, tick, active);

        // Each superstep is its own child context so it renders as a tick in tooling and so the
        // node contexts nest beneath it. Encodes the tick path in the name (§6 fallback).
        const deltas = await context.runInChildContext<NodeResult<C>[]>(
          `superstep-${tick}`,
          async (tickCtx) => {
            const capturedResume = resume;
            const batch = await tickCtx.parallel<NodeResult<C>>(
              `tick-${tick}`,
              active.map((nodeName) => ({
                name: nodePath(tick, nodeName),
                func: async (
                  nodeCtx: DurableContext,
                ): Promise<NodeResult<C>> => {
                  const ctxForNode: NodeContext = {
                    ctx: nodeCtx,
                    resume: capturedResume,
                  };
                  const delta = await graph.nodes[nodeName](state, ctxForNode);
                  // Carry the node name in the payload (brief guidance): attribution must not
                  // depend on batch ordering.
                  return { node: nodeName, delta: delta ?? undefined };
                },
              })),
              { maxConcurrency: graph.maxConcurrency },
            );
            // Superstep failure policy: fail-fast (design doc §15 q6 — POC choice). Any node
            // failure fails the superstep and, via the child context, the graph.
            batch.throwIfError();
            return batch.getResults();
          },
          { subType: "GraphSuperstep" },
        );

        resume = undefined;

        // Fold OUTSIDE steps: deterministic, cheap, re-runs on replay (§4.4/§4.5). Order the
        // deltas by the *ordered active frontier* so folding is itself deterministic even if
        // the batch returned them in a different order.
        const byNode = new Map<string, DeltaOf<C> | undefined>();
        for (const r of deltas) {
          byNode.set(r.node, r.delta);
        }
        for (const nodeName of active) {
          if (byNode.has(nodeName)) {
            state = graph.schema.reduce(state, byNode.get(nodeName));
          }
        }

        frontier = graph.orderFrontier(
          graph.route(active, state as Readonly<StateOf<C>>),
        );
      }

      return state;
    },
    { subType: "DurableGraph" },
  );
}
