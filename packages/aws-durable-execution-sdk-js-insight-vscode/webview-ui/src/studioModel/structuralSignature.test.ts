import { autoLayout, structuralSignature } from "./layout";
import { parseWorkflow } from "./model";

const wfWith = () =>
  parseWorkflow({
    name: "t",
    nodes: [
      { id: "s", kind: "start", name: "start" },
      { id: "a", kind: "step", name: "step1" },
      { id: "b", kind: "step", name: "step2" },
    ],
    edges: [
      { id: "e1", source: "s", target: "a" },
      { id: "e2", source: "a", target: "b" },
    ],
  });

describe("structuralSignature", () => {
  it("is stable across node/edge array reordering", () => {
    const wf = wfWith();
    const reordered = {
      ...wf,
      nodes: [...wf.nodes].reverse(),
      edges: [...wf.edges].reverse(),
    };
    expect(structuralSignature(reordered)).toBe(structuralSignature(wf));
  });

  it("does NOT change when only node positions move (drag)", () => {
    const wf = wfWith();
    const before = structuralSignature(wf);
    const dragged = {
      ...wf,
      nodes: wf.nodes.map((n) => ({
        ...n,
        position: { x: n.position.x + 999, y: n.position.y - 42 },
      })),
    };
    expect(structuralSignature(dragged)).toBe(before);
  });

  it("is invariant under auto-layout (auto-layout only moves positions)", () => {
    const wf = wfWith();
    expect(structuralSignature(autoLayout(wf, "TB"))).toBe(
      structuralSignature(wf),
    );
    expect(structuralSignature(autoLayout(wf, "LR"))).toBe(
      structuralSignature(wf),
    );
  });

  it("changes when a node is added or removed", () => {
    const wf = wfWith();
    const before = structuralSignature(wf);
    const added = {
      ...wf,
      nodes: [
        ...wf.nodes,
        {
          id: "c",
          kind: "step" as const,
          name: "step3",
          position: { x: 0, y: 0 },
        },
      ],
    };
    expect(structuralSignature(added)).not.toBe(before);

    const removed = { ...wf, nodes: wf.nodes.filter((n) => n.id !== "b") };
    expect(structuralSignature(removed)).not.toBe(before);
  });

  it("changes when a connection is added or removed", () => {
    const wf = wfWith();
    const before = structuralSignature(wf);
    const added = {
      ...wf,
      edges: [...wf.edges, { id: "e3", source: "s", target: "b" }],
    };
    expect(structuralSignature(added)).not.toBe(before);

    const removed = { ...wf, edges: wf.edges.filter((e) => e.id !== "e2") };
    expect(structuralSignature(removed)).not.toBe(before);
  });
});
