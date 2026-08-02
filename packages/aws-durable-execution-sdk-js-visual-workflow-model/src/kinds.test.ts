import { DAR_NODE_KINDS, type DarNodeKind } from "./kinds";
import { DAR_JSON_SCHEMA } from "./schema";

/**
 * Tests for the `dagContainer` node kind — the dedicated body-bearing container
 * whose inner scope is always `dependencyMode: "dag"` (the corrected DAG model:
 * nested DAG is a `dagContainer`, never a group-with-dag-body).
 */
describe("dagContainer node kind", () => {
  it("is a member of DAR_NODE_KINDS", () => {
    expect(DAR_NODE_KINDS).toContain("dagContainer");
  });

  it("sits next to the other container kinds (map/group/parallel)", () => {
    const kinds = DAR_NODE_KINDS as readonly string[];
    // dagContainer lives in the container cluster, before parallel.
    expect(kinds.indexOf("dagContainer")).toBeGreaterThan(
      kinds.indexOf("group"),
    );
    expect(kinds.indexOf("dagContainer")).toBeLessThan(
      kinds.indexOf("parallel"),
    );
  });

  it("is typed as a DarNodeKind", () => {
    const k: DarNodeKind = "dagContainer";
    expect(k).toBe("dagContainer");
  });

  it("is picked up by the JSON schema's node.kind enum", () => {
    const kindEnum = DAR_JSON_SCHEMA.definitions.node.properties.kind
      .enum as readonly string[];
    expect(kindEnum).toContain("dagContainer");
  });

  it("expresses a dagContainer as a container node with a dag body", () => {
    const wf = {
      name: "root",
      dependencyMode: "linear",
      nodes: [
        {
          id: "n1",
          kind: "dagContainer",
          name: "phase",
          body: {
            name: "phase-body",
            dependencyMode: "dag",
            nodes: [{ id: "a", kind: "step", name: "a" }],
            edges: [],
          },
        },
      ],
      edges: [],
    };
    // Round-trips cleanly and the body carries dag mode.
    expect(JSON.parse(JSON.stringify(wf))).toEqual(wf);
  });
});
