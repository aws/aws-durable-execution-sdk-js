import { generateHandler } from "./generateHandler";
import type { DarWorkflow } from "./darModel";

/** A minimal linear body: start → one step returning a constant. */
function bodyWithStep(stepName: string, code: string): DarWorkflow {
  return {
    darVersion: "1.0",
    name: "body",
    nodes: [
      { id: "s", kind: "start", name: "start" },
      { id: "a", kind: "step", name: stepName, code },
    ],
    edges: [{ id: "e1", source: "s", target: "a" }],
  };
}

function oneContainer(node: Record<string, unknown>): DarWorkflow {
  return {
    darVersion: "1.0",
    name: "container",
    nodes: [
      { id: "s", kind: "start", name: "start" },
      { id: "n", name: "op", ...node } as never,
    ],
    edges: [{ id: "e1", source: "s", target: "n" }],
  };
}

describe("container codegen", () => {
  it("emits runInChildContext for a group with its body", () => {
    const code = generateHandler(
      oneContainer({ kind: "group", body: bodyWithStep("Inner", "return 1;") }),
    );
    expect(code).toContain(
      'const op = await context.runInChildContext("op", async (childCtx) => {',
    );
    expect(code).toContain(
      'const Inner = await childCtx.step("Inner", async (stepCtx) => {',
    );
    // Nested body returns its own last result.
    expect(code).toContain("return Inner;");
  });

  it("emits context.map with an items IIFE, item/index params, and config", () => {
    const code = generateHandler(
      oneContainer({
        kind: "map",
        itemsCode: "return input.items;",
        maxConcurrency: 4,
        minSuccessful: 2,
        nesting: "FLAT",
        body: bodyWithStep("Handle", "return item;"),
      }),
    );
    expect(code).toContain(
      'const op = await context.map("op", ((): unknown[] => {',
    );
    expect(code).toContain("return input.items;");
    expect(code).toContain("async (ctx, item, index) => {");
    expect(code).toContain('const Handle = await ctx.step("Handle"');
    expect(code).toContain("maxConcurrency: 4");
    expect(code).toContain("completionConfig: { minSuccessful: 2 }");
    expect(code).toContain("nesting: NestingType.FLAT");
    expect(code).toContain("  NestingType,");
  });

  it("emits context.parallel with named branches", () => {
    const code = generateHandler(
      oneContainer({
        kind: "parallel",
        maxConcurrency: 2,
        branches: [
          { id: "b1", name: "left", body: bodyWithStep("L", "return 1;") },
          { id: "b2", name: "right", body: bodyWithStep("R", "return 2;") },
        ],
      }),
    );
    expect(code).toContain('const op = await context.parallel("op", [');
    expect(code).toContain('name: "left",');
    expect(code).toContain('name: "right",');
    expect(code).toContain("func: async (ctx) => {");
    expect(code).toContain('const L = await ctx.step("L"');
    expect(code).toContain('const R = await ctx.step("R"');
    expect(code).toContain("maxConcurrency: 2");
  });

  it("is deterministic for nested containers", () => {
    const wf = oneContainer({
      kind: "group",
      body: bodyWithStep("Inner", "return 1;"),
    });
    expect(generateHandler(wf)).toBe(generateHandler(wf));
  });
});
