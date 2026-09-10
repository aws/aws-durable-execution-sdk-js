import { StateGraph } from "../state-graph";
import { GraphValidationError } from "../errors";
import { StateSchema, lastValue, START, END } from "../../schema";

const schema = new StateSchema({ v: lastValue<number>(0) });

const noop = async () => ({});

describe("StateGraph validation", () => {
  it("compiles a valid linear graph and computes the entry frontier", () => {
    const g = new StateGraph(schema)
      .addNode("a", noop)
      .addNode("b", noop)
      .addEdge(START, "a")
      .addEdge("a", "b")
      .addEdge("b", END)
      .compile();
    expect(g.entry).toEqual(["a"]);
  });

  it("rejects an edge to an unknown node", () => {
    const g = new StateGraph(schema)
      .addNode("a", noop)
      .addEdge(START, "a")
      .addEdge("a", "ghost");
    expect(() => g.compile()).toThrow(GraphValidationError);
  });

  it("rejects an unreachable node", () => {
    const g = new StateGraph(schema)
      .addNode("a", noop)
      .addNode("island", noop)
      .addEdge(START, "a")
      .addEdge("a", END)
      // island connects to END but nothing reaches island
      .addEdge("island", END);
    expect(() => g.compile()).toThrow(/unreachable from START/);
  });

  it("rejects a node with no path to END", () => {
    const g = new StateGraph(schema)
      .addNode("a", noop)
      .addNode("sink", noop)
      .addEdge(START, "a")
      .addEdge("a", "sink");
    // sink has no outgoing edge to END
    expect(() => g.compile()).toThrow(/no path to END/);
  });

  it("rejects a graph with no entry", () => {
    const g = new StateGraph(schema).addNode("a", noop).addEdge("a", END);
    expect(() => g.compile()).toThrow(/no entry/);
  });

  it("rejects reserved sentinel node names", () => {
    expect(() => new StateGraph(schema).addNode(START, noop)).toThrow(
      GraphValidationError,
    );
    expect(() => new StateGraph(schema).addNode(END, noop)).toThrow(
      GraphValidationError,
    );
  });

  it("rejects duplicate node definitions", () => {
    const g = new StateGraph(schema).addNode("a", noop);
    expect(() => g.addNode("a", noop)).toThrow(/already defined/);
  });

  it("validates conditional-edge ends and accepts a cyclic graph", () => {
    const g = new StateGraph(schema)
      .addNode("agent", noop)
      .addNode("tools", noop)
      .addEdge(START, "agent")
      .addEdge("tools", "agent")
      .addConditionalEdges("agent", () => END, ["tools", END])
      .compile();
    expect(g.entry).toEqual(["agent"]);
    // route from agent with a state the router will send to END
    expect(g.route(["agent"], { v: 0 })).toEqual([]);
  });

  it("orderFrontier dedupes and sorts (deterministic ordering, invariant 6)", () => {
    const g = new StateGraph(schema)
      .addNode("b", noop)
      .addNode("a", noop)
      .addEdge(START, "a")
      .addEdge(START, "b")
      .addEdge("a", END)
      .addEdge("b", END)
      .compile();
    expect(g.orderFrontier(["b", "a", "b"])).toEqual(["a", "b"]);
  });
});
