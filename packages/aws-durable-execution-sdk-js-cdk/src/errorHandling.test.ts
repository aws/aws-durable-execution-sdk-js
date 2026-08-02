import { generateHandler } from "./generateHandler";
import type { DarWorkflow } from "./darModel";

describe("error handling codegen (node.onError branches)", () => {
  it("fallback branch: runs the block in an IIFE and binds the result", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "fb",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "a",
          kind: "step",
          name: "Fetch",
          code: "return await get();",
          onError: [{ id: "b1", fallbackCode: "return { cached: true };" }],
        } as never,
      ],
      edges: [{ id: "e1", source: "s", target: "a" }],
    };
    const code = generateHandler(wf);
    expect(code).toContain("let Fetch;");
    expect(code).toContain("Fetch = await context.step(");
    expect(code).toContain("} catch (err) {");
    expect(code).toContain("Fetch = await (async () => {");
    expect(code).toContain("return { cached: true };");
    expect(code).toContain("return Fetch;");
  });

  it("route branch (single, unlabeled) runs the target tail", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "route",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "a",
          kind: "step",
          name: "Risky",
          code: "return danger();",
        } as never,
        { id: "h", kind: "step", name: "Handle", code: "return recover(err);" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "b1", source: "a", target: "h", kind: "error" },
      ],
    };
    const code = generateHandler(wf);
    expect(code).toContain("} catch (err) {");
    expect(code).toContain('const Handle = await context.step("Handle"');
    expect(code).not.toContain("if (__darErrorIs(");
  });

  it("typed branches mixing route and fallback build an instanceof chain", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "typed",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "a",
          kind: "step",
          name: "Call",
          code: "return api();",
          onError: [
            {
              id: "b2",
              errorType: "ValidationError",
              fallbackCode: "return null;",
            },
            { id: "b3", fallbackCode: "return log(err);" },
          ],
        } as never,
        { id: "t", kind: "step", name: "OnTimeout", code: "return retry();" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        {
          id: "b1",
          source: "a",
          target: "t",
          kind: "error",
          errorType: "TimeoutError",
        },
      ],
    };
    const code = generateHandler(wf);
    expect(code).toContain('if (__darErrorIs(err, "TimeoutError")) {');
    expect(code).toContain('const OnTimeout = await context.step("OnTimeout"');
    expect(code).toContain(
      '} else if (__darErrorIs(err, "ValidationError")) {',
    );
    expect(code).toContain("Call = await (async () => {");
    expect(code).toContain("return null;");
    expect(code).toContain("} else {");
    expect(code).toContain("return log(err);");
  });

  it("typed branches with no catch-all rethrow in the else", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "typed2",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "a",
          kind: "step",
          name: "Call",
          code: "return api();",
        } as never,
        { id: "t", kind: "step", name: "OnTimeout", code: "return retry();" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        {
          id: "b1",
          source: "a",
          target: "t",
          kind: "error",
          errorType: "TimeoutError",
        },
      ],
    };
    const code = generateHandler(wf);
    expect(code).toContain('if (__darErrorIs(err, "TimeoutError")) {');
    expect(code).toContain("} else {");
    expect(code).toContain("throw err;");
  });

  it("does not wrap nodes with no error branches", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "plain",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "Step1", code: "return 1;" },
      ],
      edges: [{ id: "e1", source: "s", target: "a" }],
    };
    const code = generateHandler(wf);
    expect(code).toContain("const Step1 = await context.step(");
    expect(code).not.toContain("try {");
  });
});
