/**
 * Lambda entry for the Bedrock support-agent example.
 *
 * Builds the graph around the REAL Bedrock model ({@link createBedrockModel}) and wraps it as a
 * durable Lambda handler with {@link compileDurable}. `event.input` is folded into the graph's
 * initial state (see {@link GraphHandlerEvent}), so an invocation looks like:
 *
 *   { "input": { "messages": { "role": "user", "content": "Please refund order A-91." } } }
 *
 * The graph reaches an interrupt whenever the model asks to refund more than the approval
 * threshold; the invocation then ENDS and waits — at zero cost — for the approval callback. See
 * this example's README for how to resume it.
 *
 * The graph is built at module scope with a fixed model, so topology never depends on the event
 * payload (brief invariant 5). The model is injected (not imported-and-called inside the node),
 * which is exactly the seam the local test uses to swap in a deterministic stub.
 */

import { compileDurable } from "../../src/runtime/compile-durable";
import { buildSupportAgentGraph } from "./graph";
import { createBedrockModel } from "./model";

/** The compiled graph, wired to real Bedrock. Built once per cold start. */
const graph = buildSupportAgentGraph(createBedrockModel());

/** The durable Lambda handler (`index.handler` after bundling). */
export const handler = compileDurable(graph);
