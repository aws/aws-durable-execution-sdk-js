import { generateHandler } from "./generateHandler";
import type { DarWorkflow } from "./darModel";

// These exercise DAG codegen, which is gated because the generated code calls a
// runtime the SDK does not implement yet (see dagModeAllowed). Opting in here
// keeps coverage of the generator while the gate protects real deploys.
//
// NOTE: these assert on generated STRINGS, so they cannot catch the missing
// runtime — that needs a test which INVOKES a generated handler against the real
// SDK. Tracked with the gate.
process.env.DAR_ALLOW_DAG_MODE = "1";

/**
 * A dynamic wait duration accepts either a bare EXPRESSION or a statement block
 * that returns. Requiring `return` used to be the only supported form, which
 * made the natural `12` evaluate to `undefined` inside the generated IIFE and
 * produce `{ seconds: undefined }` with no error anywhere.
 */
function wf(
  durationCode: string,
  dependencyMode: "linear" | "dag" = "linear",
): DarWorkflow {
  return {
    darVersion: "1",
    name: "w",
    dependencyMode,
    nodes: [
      { id: "s", kind: "start", name: "start" },
      { id: "a", kind: "step", name: "get-order", code: "return { r: 5 };" },
      { id: "b", kind: "wait", name: "cooldown", durationCode },
    ],
    edges: [
      { id: "e1", source: "s", target: "a" },
      { id: "e2", source: "a", target: "b" },
    ],
  } as never;
}

describe("wait dynamic duration", () => {
  it("inlines a bare numeric expression, with no IIFE", () => {
    const code = generateHandler(wf("12"));
    expect(code).toContain('wait("cooldown", { seconds: (12) })');
    expect(code).not.toContain("})()");
  });

  it("inlines an expression referencing an upstream result", () => {
    expect(generateHandler(wf("get_order.r * 2"))).toContain(
      "{ seconds: (get_order.r * 2) }",
    );
  });

  it("keeps the IIFE for a statement block", () => {
    const code = generateHandler(wf("const x = 3;\nreturn x * 2;"));
    expect(code).toContain("{ seconds: (() => {");
    expect(code).toContain("return x * 2;");
  });

  it("treats a lone return as a block, not an expression", () => {
    expect(generateHandler(wf("return 12;"))).toContain("{ seconds: (() => {");
  });

  it("supports both spellings in DAG mode", () => {
    expect(generateHandler(wf("12", "dag"))).toContain("{ seconds: (12) }");
    expect(generateHandler(wf("return 12;", "dag"))).toContain(
      "{ seconds: (() => {",
    );
  });

  it("still honors the static duration when no code is set", () => {
    const plain = wf("");
    (plain.nodes[2] as unknown as Record<string, unknown>).durationValue = 30;
    (plain.nodes[2] as unknown as Record<string, unknown>).durationUnit =
      "minutes";
    expect(generateHandler(plain)).toContain("{ minutes: 30 }");
  });
});
