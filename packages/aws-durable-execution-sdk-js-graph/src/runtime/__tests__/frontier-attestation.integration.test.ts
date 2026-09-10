import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { compileDurable } from "../compile-durable";
import { GraphDriftError } from "../errors";
import { StateGraph } from "../../builder";
import { StateSchema, appendValue, lastValue, START, END } from "../../schema";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("GraphDriftError", () => {
  it("carries the tick, recorded, and computed frontiers in its message", () => {
    const err = new GraphDriftError("drift", 2, ["a", "b"], ["a", "c"]);
    expect(err).toBeInstanceOf(GraphDriftError);
    expect(err).toBeInstanceOf(Error);
    expect(err.tick).toBe(2);
    expect(err.recorded).toEqual(["a", "b"]);
    expect(err.computed).toEqual(["a", "c"]);
    expect(err.message).toContain("tick 2");
    expect(err.message).toContain("recorded=[a, b]");
    expect(err.message).toContain("computed=[a, c]");
  });
});

describe("frontier attestation on a clean run", () => {
  // A linear 3-node graph with no interrupt: exercises the attestation step on every tick
  // and asserts it never false-positives on a straightforward run (the demo covers the
  // cyclic/interrupt case).
  const schema = new StateSchema({
    trail: appendValue<string>(),
    done: lastValue<boolean>(false),
  });

  const graph = new StateGraph(schema, "linear")
    .addNode("a", async () => ({ trail: "a" }))
    .addNode("b", async () => ({ trail: "b" }))
    .addNode("c", async () => ({ trail: "c", done: true }))
    .addEdge(START, "a")
    .addEdge("a", "b")
    .addEdge("b", "c")
    .addEdge("c", END)
    .compile();

  it("runs a linear graph to completion with attestation enabled", async () => {
    const handler = compileDurable(graph);
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const result = await runner.run({ payload: { input: {} } });
    expect(result.getResult()).toEqual({
      trail: ["a", "b", "c"],
      done: true,
    });
  });

  it("orders a multi-node frontier deterministically before dispatch", async () => {
    // Fan-out from START to two nodes that both go to END. orderFrontier sorts, so the
    // attestation record is stable regardless of declaration order.
    const fanSchema = new StateSchema({ hits: appendValue<string>() });
    const fan = new StateGraph(fanSchema, "fan")
      .addNode("zeta", async () => ({ hits: "zeta" }))
      .addNode("alpha", async () => ({ hits: "alpha" }))
      .addEdge(START, "zeta")
      .addEdge(START, "alpha")
      .addEdge("zeta", END)
      .addEdge("alpha", END)
      .compile();
    // Entry frontier is sorted.
    expect(fan.entry).toEqual(["alpha", "zeta"]);

    const handler = compileDurable(fan);
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const result = await runner.run({ payload: { input: {} } });
    const state = result.getResult() as { hits: string[] };
    // Both ran; folding order follows the ordered frontier (alpha before zeta).
    expect(state.hits).toEqual(["alpha", "zeta"]);
  });
});
