import { generateHandler } from "./generateHandler";
import type { DarWorkflow } from "./darModel";

/** start → step1 → end (end configured via `endNode`). */
function withEnd(endNode: Record<string, unknown>): DarWorkflow {
  return {
    darVersion: "1.0",
    name: "ends",
    dependencyMode: "linear",
    nodes: [
      { id: "s", kind: "start", name: "start" },
      { id: "a", kind: "step", name: "Step1", code: "return 1;" },
      { id: "e", kind: "end", name: "end", ...endNode } as never,
    ],
    edges: [
      { id: "e1", source: "s", target: "a" },
      { id: "e2", source: "a", target: "e" },
    ],
  };
}

describe("end-node codegen", () => {
  it("returns the last result when the end has no config", () => {
    const code = generateHandler(withEnd({}));
    expect(code).toContain("return Step1;");
    // Exactly one return (no duplicate trailing return).
    expect((code.match(/return Step1;/g) ?? []).length).toBe(1);
  });

  it("emits a custom return block that can reference upstream results", () => {
    const code = generateHandler(
      withEnd({ endMode: "return", code: "return { total: Step1 };" }),
    );
    expect(code).toContain("return { total: Step1 };");
    expect(code).not.toContain("return Step1;");
  });

  it("throws a default error when endMode is throw and code is blank", () => {
    const code = generateHandler(withEnd({ endMode: "throw" }));
    expect(code).toContain('throw new Error("Workflow ended at \\"end\\".");');
    expect(code).not.toContain("return Step1;");
  });

  it("emits a custom throw block", () => {
    const code = generateHandler(
      withEnd({ endMode: "throw", code: 'throw new Error("rejected");' }),
    );
    expect(code).toContain('throw new Error("rejected");');
  });

  it("lets condition branches return data or throw per branch", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "branch-ends",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "c", kind: "condition", name: "route", code: "return event.k;" },
        {
          id: "ok",
          kind: "end",
          name: "ok",
          endMode: "return",
          code: "return { ok: true };",
        } as never,
        {
          id: "bad",
          kind: "end",
          name: "bad",
          endMode: "throw",
          code: 'throw new Error("bad");',
        } as never,
      ],
      edges: [
        { id: "e1", source: "s", target: "c" },
        { id: "e2", source: "c", target: "ok", match: "OK" },
        { id: "e3", source: "c", target: "bad" },
      ],
    };
    const code = generateHandler(wf);
    expect(code).toContain("return { ok: true };");
    expect(code).toContain('throw new Error("bad");');
    // Branches that return/throw need no break.
    expect(code).not.toContain("break;");
  });
});
