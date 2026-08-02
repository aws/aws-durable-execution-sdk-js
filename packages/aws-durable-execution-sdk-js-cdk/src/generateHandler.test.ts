import { generateHandler } from "./generateHandler";
import type { DarWorkflow } from "./darModel";

/** start → StepA → StepB → StepC → end (linear). */
function threeSteps(): DarWorkflow {
  return {
    darVersion: "1.0",
    name: "three-steps",
    dependencyMode: "linear",
    nodes: [
      { id: "s", kind: "start", name: "start" },
      { id: "a", kind: "step", name: "StepA", code: "return 1;" },
      { id: "b", kind: "step", name: "StepB", code: "return StepA + 1;" },
      { id: "c", kind: "step", name: "StepC", code: "return StepB + 1;" },
      { id: "e", kind: "end", name: "end" },
    ],
    edges: [
      { id: "e1", source: "s", target: "a" },
      { id: "e2", source: "a", target: "b" },
      { id: "e3", source: "b", target: "c" },
      { id: "e4", source: "c", target: "e" },
    ],
  };
}

describe("generateHandler", () => {
  it("binds each step result to a const named after the node", () => {
    const code = generateHandler(threeSteps());
    expect(code).toContain(
      'const StepA = await context.step("StepA", async (stepCtx) => {',
    );
    expect(code).toContain(
      'const StepB = await context.step("StepB", async (stepCtx) => {',
    );
    expect(code).toContain(
      'const StepC = await context.step("StepC", async (stepCtx) => {',
    );
  });

  it("lets a later step reference an earlier step's result const", () => {
    const code = generateHandler(threeSteps());
    // StepB's body references StepA; StepC's references StepB.
    expect(code).toContain("return StepA + 1;");
    expect(code).toContain("return StepB + 1;");
  });

  it("emits the steps in execution order and returns the last result", () => {
    const code = generateHandler(threeSteps());
    const posA = code.indexOf("const StepA");
    const posB = code.indexOf("const StepB");
    const posC = code.indexOf("const StepC");
    expect(posA).toBeLessThan(posB);
    expect(posB).toBeLessThan(posC);
    expect(code).toContain("return StepC;");
  });

  it("is deterministic (same .dar ⇒ identical handler)", () => {
    expect(generateHandler(threeSteps())).toBe(generateHandler(threeSteps()));
  });

  it("throws when two names collide on the same identifier", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "collide",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "my step", code: "return 1;" },
        { id: "b", kind: "step", name: "my-step", code: "return 2;" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "e2", source: "a", target: "b" },
      ],
    };
    expect(() => generateHandler(wf)).toThrow(
      /map to the identifier "my_step"/,
    );
  });

  it("throws when a name maps to a reserved identifier", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "reserved",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "event", code: "return 1;" },
      ],
      edges: [{ id: "e1", source: "s", target: "a" }],
    };
    expect(() => generateHandler(wf)).toThrow(/reserved identifier "event"/);
  });

  it("decodes a Lambda InvokeCommand Payload before JSON.parse", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "invoke",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "a",
          kind: "step",
          name: "call",
          code: "const response = await client.send(cmd);\nreturn JSON.parse(response.Payload);",
        },
      ],
      edges: [{ id: "e1", source: "s", target: "a" }],
    };
    const out = generateHandler(wf);
    expect(out).toContain(
      // Routed through the emitted helper rather than an inline TextDecoder: an
      // unconditional decode THROWS when Payload is already a string, so the
      // "safety net" could break working code. The helper passes a string through.
      "JSON.parse(__darDecodePayload(response.Payload))",
    );
    expect(out).not.toMatch(/JSON\.parse\(response\.Payload\)/);
  });

  it("guards map items against nullish (won't crash on missing input)", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "map",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "m",
          kind: "map",
          name: "each",
          itemsCode: "return input.items;",
          body: {
            darVersion: "1.0",
            name: "b",
            nodes: [
              { id: "bs", kind: "start", name: "start" },
              {
                id: "x",
                kind: "step",
                name: "x",
                code: "return item;",
                terminal: true,
              },
            ],
            edges: [{ id: "be", source: "bs", target: "x" }],
          },
        },
      ],
      edges: [{ id: "e1", source: "s", target: "m" }],
    };
    const out = generateHandler(wf);
    expect(out).toContain("})() ?? []");
  });

  it("emits a shared downstream node's code into EVERY condition branch that reaches it, not just the first (regression: branches used to share one `visited` set, silently dropping the shared tail from every branch but the first-processed one)", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "converging-condition",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "cond",
          kind: "condition",
          name: "cond",
          code: "return input.flag ? 'YES' : 'NO';",
        },
        {
          id: "shared",
          kind: "step",
          name: "shared",
          code: "return 'shared-ran';",
          terminal: true,
        },
      ],
      edges: [
        { id: "e1", source: "s", target: "cond" },
        { id: "e2", source: "cond", target: "shared", match: "YES" },
        // No `match` -> the default/else branch, reconverging on the SAME
        // "shared" node as the "YES" branch above (the ASL equivalent of two
        // Choice branches both `Next`-ing into the same state name).
        { id: "e3", source: "cond", target: "shared" },
      ],
    };
    const out = generateHandler(wf);
    const caseMatches = out.match(/case "YES": \{[\s\S]*?\}/);
    const defaultMatches = out.match(/default: \{[\s\S]*?\}/);
    expect(caseMatches?.[0]).toContain("'shared-ran'");
    // The regression: this used to be an empty `default: { break; }` because
    // the "YES" branch (processed first) had already marked "shared" visited
    // in a set shared across both branches.
    expect(defaultMatches?.[0]).toContain("'shared-ran'");
  });
});
