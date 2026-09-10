/**
 * Cloud entry point for the Durable Graph POC.
 *
 * esbuild bundles this file (compiling the graph package's TypeScript source and inlining the
 * core SDK from the monorepo root node_modules) into a single CJS file deployed as the Lambda
 * handler `index.handler`.
 *
 * We import the graph package from its TypeScript SOURCE (`../src/...`) rather than its built
 * `dist`, for two reasons: (1) the built package is a single rolled-up bundle that does not
 * re-export the demo `refundGraph`, and (2) esbuild compiles TS natively, so pointing at source
 * is simpler and guarantees we bundle exactly the reviewed code. The core SDK
 * (`@aws/durable-execution-sdk-js`) is a bare specifier and resolves from the monorepo root
 * node_modules where it is installed — esbuild inlines it.
 *
 * A SINGLE deployed function serves every cloud validation; behaviour is selected by
 * `event.mode`:
 *
 *   - "refund" (default): run the Appendix A refund-approval graph. Reaches an interrupt
 *     (waitForCallback "approval"). Drives V1 (happy path), V2 (zero-cost suspension) and
 *     V3 (replay across a genuine invocation end — the suspension forces one).
 *
 *   - "longnames": run a linear graph `START -> <longNode> -> END` whose node NAME is
 *     `event.nameLen` characters. The driver encodes that name into the operation `Name`
 *     (`t0/<longname>` and `t0/<longname>/mark`), so this probes any Operation.Name length cap
 *     in the real backend (V4). Runs straight to completion (no interrupt).
 */

import {
  runGraph,
  StateGraph,
  StateSchema,
  lastValue,
  appendValue,
  START,
  END,
} from "../src/index";
import { refundGraph } from "../src/demo/refund-agent";
import { withDurableExecution } from "@aws/durable-execution-sdk-js";

/**
 * Build a linear graph `START -> <longNode> -> END` whose node name length is `nameLen`.
 * The node writes a marker value into a last-write-wins channel and runs one inner step
 * (`mark`) so we also exercise a `localPath` name `t0/<longName>/mark`.
 */
function buildLongNameGraph(nameLen) {
  const longName = "n" + "x".repeat(Math.max(0, nameLen - 1));
  const schema = new StateSchema({
    marker: lastValue(null),
    messages: appendValue(),
  });
  const graph = new StateGraph(schema, "longname-probe");
  graph.addNode(longName, async (_state, { ctx }) => {
    const v = await ctx.step("mark", async () => nameLen);
    return { marker: v };
  });
  graph.addEdge(START, longName);
  graph.addEdge(longName, END);
  return { graph: graph.compile(), longName };
}

/**
 * The deployed Lambda handler. Dispatches on event.mode. Returns the graph's final state.
 * Note: we call `runGraph(context, ...)` directly (rather than the `compileDurable` wrapper)
 * so the graph runs inside THIS single durable context, letting one handler serve all modes.
 */
export const handler = withDurableExecution(async (event, context) => {
  const mode = event?.mode || "refund";

  if (mode === "longnames") {
    const nameLen = Number(event.nameLen ?? 32);
    const { graph, longName } = buildLongNameGraph(nameLen);
    const finalState = await runGraph(context, graph, {
      messages: [{ role: "user", content: "probe" }],
    });
    return { mode, nameLen, longNameFirst8: longName.slice(0, 8), finalState };
  }

  const finalState = await runGraph(context, refundGraph, {
    messages: [{ role: "user", content: "Please refund my order A-91." }],
  });
  return { mode, finalState };
});
