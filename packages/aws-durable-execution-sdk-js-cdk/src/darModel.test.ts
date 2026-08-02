import type { DarWorkflow } from "./darModel";
import { parseWorkflow } from "./darModel";

describe("parseWorkflow — container bodies", () => {
  it("parses map and group bodies recursively, normalizing like the root", () => {
    const wf = parseWorkflow({
      name: "t",
      nodes: [
        // Bodies deliberately minimal: darVersion/edges/dependencyMode absent,
        // proving they pass through parseWorkflow (and thus migrateDar).
        { id: "m", kind: "map", name: "map1", body: { nodes: [] } },
        { id: "g", kind: "group", name: "group1", body: { nodes: [] } },
      ],
    });
    for (const id of ["m", "g"]) {
      const body = wf.nodes.find((n) => n.id === id)?.body as DarWorkflow;
      expect(body.darVersion).toBe("1.0");
      expect(body.edges).toEqual([]);
      expect(body.dependencyMode).toBe("linear");
    }
  });

  it("parses parallel branch bodies recursively (including nested containers)", () => {
    const wf = parseWorkflow({
      name: "t",
      nodes: [
        {
          id: "p",
          kind: "parallel",
          name: "par1",
          branches: [
            {
              id: "b1",
              name: "branch-1",
              body: {
                nodes: [
                  {
                    id: "inner",
                    kind: "group",
                    name: "g",
                    body: { nodes: [] },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const p = wf.nodes.find((n) => n.id === "p")!;
    const branch = (p.branches as { body: DarWorkflow }[])[0];
    expect(branch.body.darVersion).toBe("1.0");
    expect(branch.body.edges).toEqual([]);
    const inner = branch.body.nodes[0].body as DarWorkflow;
    expect(inner.darVersion).toBe("1.0");
    expect(inner.edges).toEqual([]);
  });

  it("throws a clear error for a malformed container body", () => {
    expect(() =>
      parseWorkflow({
        name: "t",
        nodes: [{ id: "m", kind: "map", name: "map1", body: {} }],
      }),
    ).toThrow("missing a `nodes` array");
  });
});
