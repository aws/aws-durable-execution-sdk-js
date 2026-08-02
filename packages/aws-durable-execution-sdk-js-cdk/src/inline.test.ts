import { generateHandler } from "./generateHandler";
import type { DarWorkflow } from "./darModel";

/** start → inline(shape) → step(use) → end */
function wf(inlineExtra: Record<string, unknown> = {}): DarWorkflow {
  return {
    darVersion: "1",
    name: "inline-wf",
    nodes: [
      { id: "s", kind: "start", name: "start" },
      {
        id: "i",
        kind: "inline",
        name: "shape",
        code: "return { doubled: event.x * 2 };",
        ...inlineExtra,
      },
      { id: "u", kind: "step", name: "use", code: "return shape.doubled;" },
      { id: "e", kind: "end", name: "end" },
    ] as never,
    edges: [
      { id: "e1", source: "s", target: "i" },
      { id: "e2", source: "i", target: "u" },
      { id: "e3", source: "u", target: "e" },
    ],
  };
}

describe("inline node codegen", () => {
  it("runs the code inline (no checkpoint step) and binds the result", () => {
    const code = generateHandler(wf());
    expect(code).toContain("const shape = (() => {");
    expect(code).toContain("return { doubled: event.x * 2 };");
    expect(code).toContain("})();");
    // Not wrapped in a durable step, so no retry/checkpoint.
    expect(code).not.toContain('context.step("shape"');
    // Downstream step can reference the bound const.
    expect(code).toContain("return shape.doubled;");
  });

  it("supports error branches via try/catch (no retry strategy)", () => {
    const code = generateHandler(
      wf({
        onError: [
          {
            errorType: "",
            action: "fallback",
            fallbackCode: "return { doubled: 0 };",
          },
        ],
      }),
    );
    expect(code).toContain("try {");
    expect(code).toContain("} catch (err) {");
  });
});
