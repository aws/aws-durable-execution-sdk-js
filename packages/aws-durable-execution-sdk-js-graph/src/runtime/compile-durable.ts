import {
  DurableContext,
  DurableExecutionConfig,
  DurableLambdaHandler,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ChannelMap, StateOf } from "../schema";
import { GraphDef } from "../builder";
import { runGraph } from "./run-graph";

/**
 * The event shape {@link compileDurable}'s handler expects: a single `input` field folded into
 * the graph's initial state. Kept minimal for the POC; a real version would let the caller map
 * the event to graph input.
 */
export interface GraphHandlerEvent {
  input?: unknown;
}

/**
 * Thin wrapper (design doc §4.3, packaging option A) for the common case where the graph *is*
 * the whole workflow. Returns a Lambda handler via `withDurableExecution` that simply runs the
 * graph on `event.input`.
 *
 * The real implementation is {@link runGraph}; `compileDurable` exists only so a graph can be a
 * handler without the caller writing the `withDurableExecution` boilerplate. For composition —
 * a graph as one operation inside a larger workflow — call {@link runGraph} directly.
 *
 * @typeParam C - The graph's channel map.
 * @param graph - The compiled graph definition.
 * @param config - Optional durable execution config passed through to `withDurableExecution`.
 */
export function compileDurable<C extends ChannelMap>(
  graph: GraphDef<C>,
  config?: DurableExecutionConfig,
): DurableLambdaHandler {
  return withDurableExecution<GraphHandlerEvent, StateOf<C>>(
    async (event: GraphHandlerEvent, context: DurableContext) =>
      runGraph(context, graph, event?.input),
    config,
  );
}
