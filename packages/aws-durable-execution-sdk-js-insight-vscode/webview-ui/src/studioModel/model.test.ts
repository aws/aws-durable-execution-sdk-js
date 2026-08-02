import {
  parseWorkflow,
  scopeExtras,
  upstreamResultNames,
  pruneOrphanEnds,
  toIdentifier,
  endNodeIdFor,
  starterDagWorkflow,
} from "./model";
import type { DarWorkflow } from "./model";

describe("starterDagWorkflow", () => {
  it("seeds a single root step — no start, no end, no edges", () => {
    const wf = starterDagWorkflow();
    expect(wf.dependencyMode).toBe("dag");
    // No start node — the SDK has no start; a root is a task with no deps.
    expect(wf.nodes.some((n) => n.kind === "start")).toBe(false);
    // No end node — a DAG completes by draining / its completion policy.
    expect(wf.nodes.some((n) => n.kind === "end")).toBe(false);
    // No node is marked terminal (a linear-only concept).
    expect(wf.nodes.every((n) => !n.terminal)).toBe(true);
    // Exactly one step named "step1", and no edges (it is a lone root task).
    expect(wf.nodes).toHaveLength(1);
    const step = wf.nodes[0];
    expect(step.kind).toBe("step");
    expect(step.name).toBe("step1");
    expect(wf.edges).toEqual([]);
  });
});

describe("parseWorkflow", () => {
  it("preserves error fallbacks + error edges and drops malformed branches", () => {
    const wf = parseWorkflow({
      name: "t",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "a",
          kind: "step",
          name: "step1",
          onError: [
            { id: "b2", errorType: "E2", fallbackCode: "return null;" },
            "garbage",
          ],
        },
        { id: "h", kind: "step", name: "handler" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "b1", source: "a", target: "h", kind: "error", errorType: "E" },
      ],
    });
    const a = wf.nodes.find((n) => n.id === "a")!;
    expect(a.onError).toHaveLength(1); // the "garbage" string entry is dropped
    expect(a.onError![0]).toMatchObject({
      errorType: "E2",
      fallbackCode: "return null;",
    });
    const errEdge = wf.edges.find((e) => e.id === "b1")!;
    expect(errEdge).toMatchObject({
      kind: "error",
      errorType: "E",
      source: "a",
      target: "h",
    });
  });

  it("keeps dependencyMode and filters edges to existing nodes", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [{ id: "s", kind: "start", name: "start" }],
      edges: [
        { id: "e1", source: "s", target: "ghost" },
        { id: "e2", source: "s", target: "s" },
      ],
    });
    expect(wf.dependencyMode).toBe("dag");
    expect(wf.edges).toHaveLength(1); // the "ghost" edge is dropped
  });

  it("preserves the workflow inputType", () => {
    const wf = parseWorkflow({
      name: "t",
      inputType: "{ orderId: string }",
      nodes: [{ id: "s", kind: "start", name: "start" }],
      edges: [],
    });
    expect(wf.inputType).toBe("{ orderId: string }");
  });

  it("rejects nodes with a kind not in the shared DAR_NODE_KINDS list", () => {
    expect(() =>
      parseWorkflow({
        name: "t",
        nodes: [{ id: "x", kind: "teleport", name: "nope" }],
        edges: [],
      }),
    ).toThrow("unknown kind: teleport");
  });
});

describe("scopeExtras", () => {
  const root: DarWorkflow = parseWorkflow({
    name: "t",
    nodes: [
      { id: "s", kind: "start", name: "start" },
      {
        id: "m",
        kind: "map",
        name: "map1",
        itemsCode: "return [];",
        body: {
          name: "b",
          nodes: [{ id: "ms", kind: "start", name: "start" }],
          edges: [],
        },
      },
      {
        id: "g",
        kind: "group",
        name: "grp",
        body: {
          name: "b",
          nodes: [{ id: "gs", kind: "start", name: "start" }],
          edges: [],
        },
      },
    ],
    edges: [],
  });

  it("exposes event/input at the root", () => {
    expect(scopeExtras(root, [])).toEqual(["event", "input"]);
  });
  it("exposes item/index inside a map body", () => {
    expect(scopeExtras(root, ["m"])).toEqual(["item", "index"]);
  });
  it("exposes nothing inside a group body (no execution input)", () => {
    expect(scopeExtras(root, ["g"])).toEqual([]);
  });
});

describe("upstreamResultNames", () => {
  it("includes ancestors reachable via a normal edge and via an error route", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "Alpha" },
        { id: "h", kind: "step", name: "Handler" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "b1", source: "a", target: "h", kind: "error" },
      ],
    });
    // Editing Handler (reached via error route) sees Alpha (the failing node).
    const scope = upstreamResultNames(wf.nodes, wf.edges, "h");
    expect(scope).toContain(toIdentifier("Alpha"));
    // start is never a result const.
    expect(scope).not.toContain("start");
  });
});

describe("pruneOrphanEnds", () => {
  it("keeps an end that is only referenced by an error route", () => {
    const endId = endNodeIdFor("x");
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "step1" },
        { id: endId, kind: "end", name: "end" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "b1", source: "a", target: endId, kind: "error" },
      ],
    });
    const pruned = pruneOrphanEnds(wf);
    expect(pruned.nodes.some((n) => n.id === endId)).toBe(true);
  });
});

describe("awsSdkCall node", () => {
  it("parses and preserves its reflected fields", () => {
    const wf = parseWorkflow({
      darVersion: "1",
      name: "sdk",
      nodes: [
        {
          id: "n1",
          kind: "awsSdkCall",
          name: "put-item",
          clientPackage: "@aws-sdk/client-dynamodb",
          clientClass: "DynamoDBClient",
          command: "PutItemCommand",
          input: '{ "TableName": "t" }',
          region: "us-east-2",
        },
      ],
      edges: [],
    });
    const n = wf.nodes[0] as unknown as Record<string, unknown>;
    expect(n.kind).toBe("awsSdkCall");
    expect(n.clientPackage).toBe("@aws-sdk/client-dynamodb");
    expect(n.clientClass).toBe("DynamoDBClient");
    expect(n.command).toBe("PutItemCommand");
    expect(n.region).toBe("us-east-2");
  });
});

describe("inline node", () => {
  it("parses and preserves its code (no retry)", () => {
    const wf = parseWorkflow({
      darVersion: "1",
      name: "inline",
      nodes: [
        {
          id: "n1",
          kind: "inline",
          name: "shape",
          code: "return { x: 1 };",
        },
      ],
      edges: [],
    });
    const n = wf.nodes[0] as unknown as Record<string, unknown>;
    expect(n.kind).toBe("inline");
    expect(n.code).toBe("return { x: 1 };");
    expect(n.retry).toBeUndefined();
  });
});
