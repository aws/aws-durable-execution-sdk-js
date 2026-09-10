import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { compileDurable } from "../runtime/compile-durable";
import { StateGraph } from "../builder";
import { StateSchema, appendValue, START, END } from "../schema";

/**
 * Design doc §11 test 3 (Fan-out ordering).
 *
 * We assert fan-out behaviour is STABLE: a superstep with multiple ready nodes produces a
 * deterministic result regardless of the order the nodes were declared or the order the batch
 * happens to return them in. Under positional identity this stability is a CORRECTNESS
 * requirement, not a nicety (POC_FINDINGS §2.1): the ordinal within the `parallel` call IS the
 * operation identity, so `orderFrontier` (sort) is what pins identity. We test the observable
 * contract; the fragility itself is documented in POC_FINDINGS §2.
 *
 * NOTE on what path identity (Phase 2) would buy: with `t1/<nodeName>` identity, a reordered
 * frontier would resolve correctly because each branch's id is independent of position. Under
 * the POC's positional scheme we MUST sort and can never relax it — that is the pain this test
 * pins down.
 */

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("fan-out / frontier ordering", () => {
  const schema = new StateSchema({ hits: appendValue<string>() });

  /**
   * Fan out from START to three nodes declared in a deliberately non-sorted order. All three
   * run in one superstep, then converge to END. `orderFrontier` sorts, so the folding order —
   * and thus the observable `hits` array — is deterministic (alphabetical), independent of
   * declaration order.
   */
  function buildFanGraph() {
    return new StateGraph(schema, "fan")
      .addNode("gamma", async () => ({ hits: "gamma" }))
      .addNode("alpha", async () => ({ hits: "alpha" }))
      .addNode("beta", async () => ({ hits: "beta" }))
      .addEdge(START, "gamma")
      .addEdge(START, "alpha")
      .addEdge(START, "beta")
      .addEdge("gamma", END)
      .addEdge("alpha", END)
      .addEdge("beta", END)
      .compile();
  }

  it("orders the entry frontier deterministically regardless of declaration order", () => {
    const graph = buildFanGraph();
    // Declared gamma, alpha, beta — entry frontier is sorted.
    expect(graph.entry).toEqual(["alpha", "beta", "gamma"]);
  });

  it("produces a stable folded result across a fan-out superstep", async () => {
    const handler = compileDurable(buildFanGraph());
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const result = await runner.run({ payload: { input: {} } });
    const state = result.getResult() as { hits: string[] };
    // All three ran; folding follows the ordered frontier, so the result is deterministic.
    expect(state.hits).toEqual(["alpha", "beta", "gamma"]);
  });

  it("is stable across repeated runs (same ordered result every time)", async () => {
    const handler = compileDurable(buildFanGraph());
    const results: string[][] = [];
    for (let i = 0; i < 3; i++) {
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });
      const result = await runner.run({ payload: { input: {} } });
      results.push((result.getResult() as { hits: string[] }).hits);
    }
    // Every run yields the identical ordered frontier fold.
    expect(results[0]).toEqual(["alpha", "beta", "gamma"]);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it("assigns each fan-out branch a distinct structural operation name (positional slot = name)", async () => {
    const handler = compileDurable(buildFanGraph());
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const result = await runner.run({ payload: { input: {} } });
    const names = result
      .getOperations()
      .map((o) => o.getName())
      .filter(Boolean) as string[];
    // Each branch is named by its (tick, node) path. The NAME is stable; the POC's fragility is
    // that the *identity* is still the positional ordinal behind that name (documented, §2).
    expect(names).toContain("t0/alpha");
    expect(names).toContain("t0/beta");
    expect(names).toContain("t0/gamma");
  });
});
