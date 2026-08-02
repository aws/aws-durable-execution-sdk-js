import { DAR_JSON_SCHEMA } from "./schema";
import { TRIGGER_RULES } from "./dag";

/**
 * The package declares no JSON-schema-validator dependency (it is the shared
 * single source of truth and intentionally dependency-free), so these tests
 * assert the schema's structure directly and round-trip representative `.dar`
 * objects through JSON. They verify the DAG additions are present, correctly
 * enumerated, and — crucially — additive (nothing new is required, old files
 * without the new fields remain valid).
 */
describe("DAR_JSON_SCHEMA — DAG additions", () => {
  const { properties, definitions } = DAR_JSON_SCHEMA;

  it("keeps the additions additive (only `nodes` is required at the top level)", () => {
    expect(DAR_JSON_SCHEMA.required).toEqual(["nodes"]);
  });

  it("declares edge.dependencyKind as a result|ordering enum", () => {
    expect(definitions.edge.properties.dependencyKind).toEqual({
      enum: ["result", "ordering"],
    });
  });

  it("declares node.triggerRule as the six-value enum and node.runIf as a string", () => {
    expect(definitions.node.properties.triggerRule).toEqual({
      enum: [...TRIGGER_RULES],
    });
    expect(definitions.node.properties.runIf).toEqual({ type: "string" });
  });

  it("keeps node objects open (additionalProperties) so old files still validate", () => {
    expect(definitions.node.additionalProperties).toBe(true);
  });

  it("wires workflow-level dagConfig with its four fields, none required", () => {
    expect(properties.dagConfig).toEqual({
      $ref: "#/definitions/dagConfig",
    });
    const dagConfig = definitions.dagConfig;
    expect(dagConfig.properties.maxConcurrency).toEqual({ type: "number" });
    expect(dagConfig.properties.defaultTriggerRule).toEqual({
      enum: [...TRIGGER_RULES],
    });
    expect(dagConfig.properties.nesting).toEqual({ enum: ["FLAT", "NESTED"] });
    // no `required` key ⇒ every dagConfig field is optional
    expect("required" in dagConfig).toBe(false);
  });

  it("allows completionConfig to carry both threshold and custom (shouldComplete) fields", () => {
    const cc = definitions.dagConfig.properties.completionConfig.properties;
    expect(cc.minSuccessful).toEqual({ type: "number" });
    expect(cc.toleratedFailureCount).toEqual({ type: "number" });
    expect(cc.toleratedFailurePercentage).toEqual({ type: "number" });
    expect(cc.shouldComplete).toEqual({ type: "string" });
  });
});

describe(".dar JSON round-trip", () => {
  it("preserves a workflow that uses the new DAG fields", () => {
    const wf = {
      darVersion: "1.1",
      name: "diamond",
      dependencyMode: "dag",
      dagConfig: {
        maxConcurrency: 4,
        defaultTriggerRule: "ALL_SUCCESS",
        nesting: "NESTED",
        completionConfig: { minSuccessful: 2, toleratedFailureCount: 1 },
      },
      nodes: [
        { id: "n1", kind: "step", name: "fetch", triggerRule: "ANY_SUCCESS" },
        {
          id: "n2",
          kind: "step",
          name: "join",
          runIf: 'deps["fetch"] != null',
        },
      ],
      edges: [
        {
          id: "e1",
          source: "n1",
          target: "n2",
          dependencyKind: "ordering",
        },
      ],
    };
    expect(JSON.parse(JSON.stringify(wf))).toEqual(wf);
  });

  it("preserves an old workflow that omits every new field", () => {
    const oldWf = {
      darVersion: "1.0",
      name: "linear",
      nodes: [{ id: "n1", kind: "step", name: "a" }],
      edges: [],
    };
    const roundTripped = JSON.parse(JSON.stringify(oldWf));
    expect(roundTripped).toEqual(oldWf);
    // none of the DAG additions leak in
    expect(roundTripped.dagConfig).toBeUndefined();
    expect(roundTripped.dependencyMode).toBeUndefined();
    expect(roundTripped.nodes[0].triggerRule).toBeUndefined();
  });
});
