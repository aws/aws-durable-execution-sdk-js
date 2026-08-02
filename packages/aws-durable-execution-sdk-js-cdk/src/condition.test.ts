import { generateHandler } from "./generateHandler";
import type { DarWorkflow } from "./darModel";

/**
 * start → condition → { "PAID" → Paid step, else → Unpaid step }
 */
function branching(): DarWorkflow {
  return {
    darVersion: "1.0",
    name: "switch",
    dependencyMode: "linear",
    nodes: [
      { id: "s", kind: "start", name: "start" },
      {
        id: "c",
        kind: "condition",
        name: "route",
        code: "return event.status;",
      },
      { id: "p", kind: "step", name: "Paid", code: "return 'paid';" },
      { id: "u", kind: "step", name: "Unpaid", code: "return 'unpaid';" },
    ],
    edges: [
      { id: "e1", source: "s", target: "c" },
      { id: "e2", source: "c", target: "p", match: "PAID" },
      { id: "e3", source: "c", target: "u" },
    ],
  };
}

describe("condition codegen", () => {
  it("evaluates the branch expression inline (no checkpoint step)", () => {
    const code = generateHandler(branching());
    // The decision is a deterministic expression over upstream results, so it
    // runs inline — not wrapped in a durable step (which would add a needless
    // checkpoint + latency on every execution).
    expect(code).toContain("const route = (() => {");
    expect(code).toContain("return event.status;");
    expect(code).not.toContain('context.step("route"');
  });

  it("switches over the decision with a case per labelled edge", () => {
    const code = generateHandler(branching());
    expect(code).toContain("switch (route) {");
    expect(code).toContain('case "PAID": {');
    expect(code).toContain("default: {");
  });

  it("emits each branch's tail inside its case", () => {
    const code = generateHandler(branching());
    expect(code).toContain('const Paid = await context.step("Paid"');
    expect(code).toContain('const Unpaid = await context.step("Unpaid"');
    // Each case ends with a break.
    expect((code.match(/break;/g) ?? []).length).toBe(2);
  });

  it("is deterministic", () => {
    expect(generateHandler(branching())).toBe(generateHandler(branching()));
  });
});
