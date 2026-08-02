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
 * Phase 2 (P2.12): DAG code generation. These exercise the `emitDagScope` path
 * (design §§3, 4, 6) — the parallel emitter reached when a scope's
 * `dependencyMode` is `"dag"`. The linear path (every other mode) is covered by
 * the sibling suites and must stay untouched. Assertions check the generated
 * call SHAPES against the real SDK signatures read from `dag-context.ts`
 * (deps = arg 2 for step/callback/wait/…; arg 3 for invoke after funcId; the
 * deps-first callback only when deps is non-empty; `.after()`/`.triggerRule()`
 * as handle builders; `runIf` in the config object).
 */

/** seed → {left, right} → merge (the canonical diamond). */
function diamond(): DarWorkflow {
  return {
    darVersion: "1.0",
    name: "diamond",
    dependencyMode: "dag",
    nodes: [
      { id: "s", kind: "start", name: "start" },
      { id: "seed", kind: "step", name: "seed", code: "return 1;" },
      { id: "left", kind: "step", name: "left", code: "return seed + 1;" },
      { id: "right", kind: "step", name: "right", code: "return seed + 2;" },
      {
        id: "merge",
        kind: "step",
        name: "merge",
        code: "return left + right;",
      },
      { id: "e", kind: "end", name: "end" },
    ],
    edges: [
      { id: "e1", source: "s", target: "seed" },
      { id: "e2", source: "seed", target: "left" },
      { id: "e3", source: "seed", target: "right" },
      { id: "e4", source: "left", target: "merge" },
      { id: "e5", source: "right", target: "merge" },
      { id: "e6", source: "merge", target: "e" },
    ],
  };
}

describe("dag codegen — container + diamond (P2.1, P2.2, P2.3)", () => {
  it("wraps the scope in `context.dag(...)` with a (dag) registrar", () => {
    const code = generateHandler(diamond());
    expect(code).toContain(
      'const result = await context.dag("diamond", (dag) => {',
    );
  });

  it("emits tasks in topological order (a handle is declared before use)", () => {
    const code = generateHandler(diamond());
    const seed = code.indexOf('dag.step("seed"');
    const left = code.indexOf('dag.step("left"');
    const right = code.indexOf('dag.step("right"');
    const merge = code.indexOf('dag.step("merge"');
    expect(seed).toBeGreaterThan(-1);
    expect(seed).toBeLessThan(left);
    expect(seed).toBeLessThan(right);
    expect(left).toBeLessThan(merge);
    expect(right).toBeLessThan(merge);
  });

  it("passes each task's result-edge sources as the deps array (SDK arg 2)", () => {
    const code = generateHandler(diamond());
    expect(code).toContain('dag.step("seed", [], async (stepCtx) => {');
    expect(code).toContain(
      'dag.step("left", [seed], async (deps, stepCtx) => {',
    );
    expect(code).toContain(
      'dag.step("merge", [left, right], async (deps, stepCtx) => {',
    );
  });

  it("returns the aggregate DagResult by default (no end config)", () => {
    const code = generateHandler(diamond());
    expect(code).toContain("return result;");
  });

  it("is byte-deterministic (same .dar ⇒ identical handler)", () => {
    expect(generateHandler(diamond())).toBe(generateHandler(diamond()));
  });
});

describe("dag scope with NO start node — roots inferred from no-incoming-edge", () => {
  /** Two independent roots (no incoming edge) + a join depending on both. No
   *  start node at all — the corrected model seeds no start in a dag scope. */
  function noStartWf(): DarWorkflow {
    return {
      darVersion: "1.0",
      name: "nostart",
      dependencyMode: "dag",
      nodes: [
        { id: "a", kind: "step", name: "a", code: "return 1;" },
        { id: "b", kind: "step", name: "b", code: "return 2;" },
        { id: "j", kind: "step", name: "join", code: "return a + b;" },
      ],
      edges: [
        { id: "e1", source: "a", target: "j" },
        { id: "e2", source: "b", target: "j" },
      ],
    };
  }

  it("emits both no-incoming tasks as roots with deps [] (no start required)", () => {
    const code = generateHandler(noStartWf());
    expect(code).toContain('dag.step("a", [], async (stepCtx) => {');
    expect(code).toContain('dag.step("b", [], async (stepCtx) => {');
  });

  it("emits the join depending on both roots and injects their shims", () => {
    const code = generateHandler(noStartWf());
    expect(code).toContain(
      'dag.step("join", [a, b], async (deps, stepCtx) => {',
    );
    expect(code).toContain('const a = deps["a"];');
    expect(code).toContain('const b = deps["b"];');
    // Roots emit before the join (topological order holds without a start).
    const a = code.indexOf('dag.step("a"');
    const b = code.indexOf('dag.step("b"');
    const j = code.indexOf('dag.step("join"');
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(j);
    expect(b).toBeLessThan(j);
  });

  it("still wraps the scope and returns the aggregate DagResult", () => {
    const code = generateHandler(noStartWf());
    expect(code).toContain(
      'const result = await context.dag("nostart", (dag) => {',
    );
    expect(code).toContain("return result;");
  });
});

describe("deps shim injection (P2.5)", () => {
  it('injects `const <ident> = deps["<name>"]` per result edge, verbatim body after', () => {
    const code = generateHandler(diamond());
    expect(code).toContain('const seed = deps["seed"];');
    expect(code).toContain('const left = deps["left"];');
    expect(code).toContain('const right = deps["right"];');
    // The author's body is byte-identical to linear mode.
    expect(code).toContain("return left + right;");
  });

  it("a root task (only a start edge) gets deps [] and no shim/deps param", () => {
    const code = generateHandler(diamond());
    expect(code).toContain('dag.step("seed", [], async (stepCtx) => {');
    expect(code).not.toContain('const seed = deps["seed"];\n        return 1;');
  });
});

describe("ordering-only deps (P2.7)", () => {
  function orderingWf(): DarWorkflow {
    return {
      darVersion: "1.0",
      name: "ord",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "a", code: "return 1;" },
        { id: "b", kind: "step", name: "b", code: "return 2;" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "e2", source: "s", target: "b" },
        // b waits for a but does NOT read its result.
        { id: "e3", source: "a", target: "b", dependencyKind: "ordering" },
      ],
    };
  }

  it("emits `.after(...)` and keeps the source OUT of the deps array + shim", () => {
    const code = generateHandler(orderingWf());
    expect(code).toContain('dag.step("b", [], async (stepCtx) => {');
    expect(code).toMatch(/dag\.step\("b",[\s\S]*?\}\)\.after\(a\);/);
    expect(code).not.toContain('const a = deps["a"];');
  });
});

describe("auto-inferred dependencyKind (§5)", () => {
  /** a → b, where b's code (may or may not) reference a. No explicit kind. */
  function inferWf(bCode: string): DarWorkflow {
    return {
      darVersion: "1.0",
      name: "infer",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "a", code: "return 1;" },
        { id: "b", kind: "step", name: "b", code: bCode },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        // No dependencyKind — the kind is inferred from b's code.
        { id: "e2", source: "a", target: "b" },
      ],
    };
  }

  it("target that does NOT reference the source → ordering (.after, no shim, not in deps)", () => {
    const code = generateHandler(inferWf("return 2;"));
    // b is emitted as a root task (deps []) that only waits on a via .after().
    expect(code).toContain('dag.step("b", [], async (stepCtx) => {');
    expect(code).toMatch(/dag\.step\("b",[\s\S]*?\}\)\.after\(a\);/);
    expect(code).not.toContain('const a = deps["a"];');
  });

  it("target that references the source by identifier → result (deps array + shim)", () => {
    const code = generateHandler(inferWf("return a + 1;"));
    // a is now a result dep: in the deps array, with the injected shim.
    expect(code).toContain(
      'const b = dag.step("b", [a], async (deps, stepCtx) => {',
    );
    expect(code).toContain('const a = deps["a"];');
    expect(code).not.toMatch(/\}\)\.after\(a\)/);
  });

  it('target that reads deps["a"] explicitly → result', () => {
    const code = generateHandler(inferWf('return deps["a"] + 1;'));
    expect(code).toContain(
      'const b = dag.step("b", [a], async (deps, stepCtx) => {',
    );
    expect(code).toContain('const a = deps["a"];');
  });

  it("stays byte-deterministic under inference", () => {
    expect(generateHandler(inferWf("return a + 1;"))).toBe(
      generateHandler(inferWf("return a + 1;")),
    );
    expect(generateHandler(inferWf("return 2;"))).toBe(
      generateHandler(inferWf("return 2;")),
    );
  });
});

describe("triggerRule + runIf config (P2.6)", () => {
  it('chains `.triggerRule("X")` on the handle (not in config)', () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "tr",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "a", code: "return 1;" },
        {
          id: "b",
          kind: "step",
          name: "b",
          code: "return 2;",
          triggerRule: "ANY_SUCCESS",
        } as never,
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "e2", source: "a", target: "b" },
      ],
    };
    const code = generateHandler(wf);
    expect(code).toContain('.triggerRule("ANY_SUCCESS");');
  });

  it("emits `runIf: (deps) => (<expr>)` in the config object", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "ri",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "a", code: "return 1;" },
        {
          id: "b",
          kind: "step",
          name: "b",
          code: "return 2;",
          runIf: 'deps["a"] > 0',
        } as never,
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "e2", source: "a", target: "b" },
      ],
    };
    const code = generateHandler(wf);
    expect(code).toContain('runIf: (deps) => (deps["a"] > 0)');
  });

  it("rejects an unknown triggerRule", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "bad",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "a",
          kind: "step",
          name: "a",
          code: "return 1;",
          triggerRule: "SOMETIMES",
        } as never,
      ],
      edges: [{ id: "e1", source: "s", target: "a" }],
    };
    expect(() => generateHandler(wf)).toThrow(/unknown triggerRule/);
  });
});

describe("condition lowering (P2.8, §4.1)", () => {
  function conditionWf(): DarWorkflow {
    return {
      darVersion: "1.0",
      name: "cond",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "c",
          kind: "condition",
          name: "decide",
          code: "return event.status;",
        },
        { id: "p", kind: "step", name: "paid", code: "return 'p';" },
        { id: "u", kind: "step", name: "unpaid", code: "return 'u';" },
      ],
      edges: [
        { id: "e1", source: "s", target: "c" },
        { id: "e2", source: "c", target: "p", match: "PAID" },
        { id: "e3", source: "c", target: "u" },
      ],
    };
  }

  it("emits the decision as a real dag.step returning the branch expression", () => {
    const code = generateHandler(conditionWf());
    expect(code).toContain(
      'const decide = dag.step("decide", [], async (stepCtx) => {',
    );
    expect(code).toContain("return event.status;");
    // No inline `switch` in dag mode.
    expect(code).not.toContain("switch (decide)");
  });

  it("gives each match target a runIf comparing deps[<cond>]", () => {
    const code = generateHandler(conditionWf());
    expect(code).toContain('runIf: (deps) => (deps["decide"] === "PAID")');
  });

  it("gives the matchless target a negated-includes runIf", () => {
    const code = generateHandler(conditionWf());
    expect(code).toContain(
      'runIf: (deps) => (!["PAID"].includes(deps["decide"] as string))',
    );
  });

  it("does NOT inject a deps shim for the condition token (routing, not data)", () => {
    const code = generateHandler(conditionWf());
    // paid/unpaid depend on `decide` (in the deps array, for runIf) but never
    // read it as a body identifier.
    expect(code).toContain(
      'dag.step("paid", [decide], async (deps, stepCtx) => {',
    );
    expect(code).not.toContain('const decide = deps["decide"];');
  });
});

describe("error handling (P2.9, §4.3)", () => {
  it("onError fallback → task-local try/catch inside the closure", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "fb",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "a",
          kind: "step",
          name: "Fetch",
          code: "return await get();",
          onError: [
            {
              id: "b1",
              errorType: "TimeoutError",
              fallbackCode: "return null;",
            },
            { id: "b2", fallbackCode: "return { cached: true };" },
          ],
        } as never,
      ],
      edges: [{ id: "e1", source: "s", target: "a" }],
    };
    const code = generateHandler(wf);
    expect(code).toContain('dag.step("Fetch", [], async (stepCtx) => {');
    expect(code).toContain("try {");
    expect(code).toContain("} catch (err) {");
    expect(code).toContain('if (__darErrorIs(err, "TimeoutError")) {');
    expect(code).toContain("return null;");
    expect(code).toContain("} else {");
    expect(code).toContain("return { cached: true };");
  });

  it("catch-all error edge → target gains .after(source) + ANY_FAILED, no shim", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "route",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "Risky", code: "return danger();" },
        { id: "h", kind: "step", name: "Handle", code: "return recover();" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "b1", source: "a", target: "h", kind: "error" },
      ],
    };
    const code = generateHandler(wf);
    expect(code).toMatch(
      /dag\.step\("Handle",[\s\S]*?\}\)\.after\(Risky\)\.triggerRule\("ANY_FAILED"\);/,
    );
    expect(code).not.toContain('const Risky = deps["Risky"];');
  });

  it("typed error edge → clear codegen error (steer to onError)", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "typed",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "Call", code: "return api();" },
        { id: "h", kind: "step", name: "OnTimeout", code: "return retry();" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        {
          id: "b1",
          source: "a",
          target: "h",
          kind: "error",
          errorType: "TimeoutError",
        },
      ],
    };
    expect(() => generateHandler(wf)).toThrow(/typed error edge/);
  });
});

describe("forbidden inline node (§4.2)", () => {
  it("throws a clear error for an inline node in a dag scope", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "inl",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "i", kind: "inline", name: "shape", code: "return 1;" },
      ],
      edges: [{ id: "e1", source: "s", target: "i" }],
    };
    expect(() => generateHandler(wf)).toThrow(
      /inline node "shape" is not allowed/,
    );
  });
});

describe("cycle detection (P2.3)", () => {
  it("throws rather than silently looping on a cyclic dag scope", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "cyc",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "a", code: "return b;" },
        { id: "b", kind: "step", name: "b", code: "return a;" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "e2", source: "a", target: "b" },
        { id: "e3", source: "b", target: "a" },
      ],
    };
    expect(() => generateHandler(wf)).toThrow(/cycle/);
  });
});

describe("nested dag via dagContainer (P2.11, §6, corrected model)", () => {
  it("a dagContainer inside a DAG scope → dag.dag(name, deps, (dag) => {...})", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "root",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "up", kind: "step", name: "up", code: "return 1;" },
        {
          id: "inner",
          kind: "dagContainer",
          name: "inner",
          body: {
            darVersion: "1.0",
            name: "innerbody",
            dependencyMode: "dag",
            nodes: [
              { id: "is", kind: "start", name: "start" },
              { id: "x", kind: "step", name: "x", code: "return 10;" },
            ],
            edges: [{ id: "ie", source: "is", target: "x" }],
          },
        } as never,
      ],
      edges: [
        { id: "e1", source: "s", target: "up" },
        // The container's BODY uses `up` (via the injected shim), but that
        // reference lives in the nested scope, not a scanned field on the
        // container node — so an explicit override keeps it a result dep.
        { id: "e2", source: "up", target: "inner", dependencyKind: "result" },
      ],
    };
    const code = generateHandler(wf);
    expect(code).toContain('const inner = dag.dag("inner", [up], (dag) => {');
    expect(code).toContain('const x = dag.step("x", [], async (stepCtx) => {');
  });

  it("carries deps + .after/runIf onto the nested dag.dag task like any other", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "root",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "up", kind: "step", name: "up", code: "return 1;" },
        {
          id: "inner",
          kind: "dagContainer",
          name: "inner",
          runIf: 'deps["up"] > 0',
          body: {
            darVersion: "1.0",
            name: "innerbody",
            dependencyMode: "dag",
            nodes: [
              { id: "is", kind: "start", name: "start" },
              { id: "x", kind: "step", name: "x", code: "return 10;" },
            ],
            edges: [{ id: "ie", source: "is", target: "x" }],
          },
        } as never,
      ],
      edges: [
        { id: "e1", source: "s", target: "up" },
        { id: "e2", source: "up", target: "inner" },
      ],
    };
    const code = generateHandler(wf);
    expect(code).toContain('runIf: (deps) => (deps["up"] > 0)');
  });
});

describe("dagContainer in a LINEAR parent scope (corrected model)", () => {
  it("a dagContainer in a LINEAR root → context.dag(name, (dag) => {...})", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "root",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "d",
          kind: "dagContainer",
          name: "phase",
          body: {
            darVersion: "1.0",
            name: "phasebody",
            dependencyMode: "dag",
            nodes: [
              { id: "bs", kind: "start", name: "start" },
              { id: "a", kind: "step", name: "a", code: "return 1;" },
              { id: "b", kind: "step", name: "b", code: "return a + 1;" },
            ],
            edges: [
              { id: "be1", source: "bs", target: "a" },
              { id: "be2", source: "a", target: "b" },
            ],
          },
        } as never,
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [
        { id: "e1", source: "s", target: "d" },
        { id: "e2", source: "d", target: "e" },
      ],
    };
    const code = generateHandler(wf);
    // Bound to the node ident, emitting `context.dag(...)` (not runInChildContext).
    expect(code).toContain(
      'const phase = await context.dag("phase", (dag) => {',
    );
    // Inner body emits DAG registrations with the deps shim.
    expect(code).toContain('const a = dag.step("a", [], async (stepCtx) => {');
    expect(code).toContain(
      'const b = dag.step("b", [a], async (deps, stepCtx) => {',
    );
    expect(code).toContain('const a = deps["a"];');
    expect(code).not.toContain("runInChildContext");
  });

  it("emits the dagContainer's own dagConfig suffix in a linear parent", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "root",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "d",
          kind: "dagContainer",
          name: "phase",
          dagConfig: { maxConcurrency: 3 },
          body: {
            darVersion: "1.0",
            name: "phasebody",
            dependencyMode: "dag",
            nodes: [
              { id: "bs", kind: "start", name: "start" },
              { id: "a", kind: "step", name: "a", code: "return 1;" },
            ],
            edges: [{ id: "be1", source: "bs", target: "a" }],
          },
        } as never,
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [
        { id: "e1", source: "s", target: "d" },
        { id: "e2", source: "d", target: "e" },
      ],
    };
    const code = generateHandler(wf);
    expect(code).toContain("maxConcurrency: 3");
  });
});

describe("group inside a DAG scope stays a linear child context (corrected model)", () => {
  it("a group in a DAG scope emits dag.runInChildContext with a LINEAR body", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "root",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "up", kind: "step", name: "up", code: "return 1;" },
        {
          id: "g",
          kind: "group",
          name: "grp",
          body: {
            darVersion: "1.0",
            name: "b",
            dependencyMode: "linear",
            nodes: [
              { id: "bs", kind: "start", name: "start" },
              { id: "x", kind: "step", name: "x", code: "return 1;" },
              { id: "y", kind: "step", name: "y", code: "return x + 1;" },
            ],
            edges: [
              { id: "be1", source: "bs", target: "x" },
              { id: "be2", source: "x", target: "y" },
            ],
          },
        } as never,
      ],
      edges: [
        { id: "e1", source: "s", target: "up" },
        // Container body consumes `up` at the boundary shim; pin as result.
        { id: "e2", source: "up", target: "g", dependencyKind: "result" },
      ],
    };
    const code = generateHandler(wf);
    expect(code).toContain(
      'const grp = dag.runInChildContext("grp", [up], async (deps, childCtx) => {',
    );
    // Its inner body runs the UNCHANGED linear emitter (identifier convention).
    expect(code).toContain(
      'const x = await childCtx.step("x", async (stepCtx) => {',
    );
    expect(code).toContain(
      'const y = await childCtx.step("y", async (stepCtx) => {',
    );
    // Never a nested dag.dag for a group (that is a dagContainer now).
    expect(code).not.toContain('dag.dag("grp"');
  });
});

describe("mixed mode (§4.4)", () => {
  it("dag root containing a group with a LINEAR body", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "root",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "up", kind: "step", name: "someUpstream", code: "return 1;" },
        {
          id: "phase",
          kind: "group",
          name: "phase",
          body: {
            darVersion: "1.0",
            name: "phasebody",
            dependencyMode: "linear",
            nodes: [
              { id: "bs", kind: "start", name: "start" },
              { id: "a", kind: "step", name: "a", code: "return 1;" },
              { id: "b", kind: "step", name: "b", code: "return a + 1;" },
            ],
            edges: [
              { id: "be1", source: "bs", target: "a" },
              { id: "be2", source: "a", target: "b" },
            ],
          },
        } as never,
        {
          id: "down",
          kind: "step",
          name: "downstream",
          code: "return phase;",
        },
      ],
      edges: [
        { id: "e1", source: "s", target: "up" },
        // The group's body reads `someUpstream` via the boundary shim (not a
        // scanned field on the group node), so pin the dep as result.
        { id: "e2", source: "up", target: "phase", dependencyKind: "result" },
        { id: "e3", source: "phase", target: "down" },
      ],
    };
    const code = generateHandler(wf);
    // group is a DAG task with deps + shim at the boundary...
    expect(code).toContain(
      'const phase = dag.runInChildContext("phase", [someUpstream], async (deps, childCtx) => {',
    );
    expect(code).toContain('const someUpstream = deps["someUpstream"];');
    // ...and its inner body runs the UNCHANGED linear emitter.
    expect(code).toContain(
      'const a = await childCtx.step("a", async (stepCtx) => {',
    );
    expect(code).toContain(
      'const b = await childCtx.step("b", async (stepCtx) => {',
    );
    expect(code).toContain("return b;");
    // downstream reads the group's returned value via the shim.
    expect(code).toContain('const phase = deps["phase"];');
  });

  it("linear root containing a map whose linear body holds a dagContainer", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "root",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "m",
          kind: "map",
          name: "each",
          itemsCode: "return input.items;",
          body: {
            darVersion: "1.0",
            name: "perItem",
            dependencyMode: "linear",
            nodes: [
              { id: "bs", kind: "start", name: "start" },
              {
                id: "dc",
                kind: "dagContainer",
                name: "fanout",
                body: {
                  darVersion: "1.0",
                  name: "fanoutBody",
                  dependencyMode: "dag",
                  nodes: [
                    { id: "is", kind: "start", name: "start" },
                    { id: "x", kind: "step", name: "x", code: "return item;" },
                  ],
                  edges: [{ id: "ie", source: "is", target: "x" }],
                },
              },
            ],
            edges: [{ id: "be", source: "bs", target: "dc" }],
          },
        } as never,
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [
        { id: "e1", source: "s", target: "m" },
        { id: "e2", source: "m", target: "e" },
      ],
    };
    const code = generateHandler(wf);
    // linear map wrapper (unchanged)...
    expect(code).toContain(
      'const each = await context.map("each", ((): unknown[] => {',
    );
    expect(code).toContain("async (ctx, item, index) => {");
    // ...whose linear per-item body holds a dagContainer → nested ctx.dag scope.
    expect(code).toContain('const fanout = await ctx.dag("fanout", (dag) => {');
    expect(code).toContain('const x = dag.step("x", [], async (stepCtx) => {');
  });
});

describe("dagConfig + completion policy (P2.2, §5)", () => {
  it("emits maxConcurrency, defaultTriggerRule, nesting, and threshold completion", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "cfg",
      dependencyMode: "dag",
      dagConfig: {
        maxConcurrency: 8,
        defaultTriggerRule: "NONE_FAILED",
        nesting: "FLAT",
        completionConfig: { minSuccessful: 2, toleratedFailureCount: 1 },
      },
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "a", code: "return 1;" },
      ],
      edges: [{ id: "e1", source: "s", target: "a" }],
    };
    const code = generateHandler(wf);
    expect(code).toContain("maxConcurrency: 8");
    expect(code).toContain('defaultTriggerRule: "NONE_FAILED"');
    expect(code).toContain("nesting: NestingType.FLAT");
    expect(code).toContain(
      "completionConfig: { minSuccessful: 2, toleratedFailureCount: 1 }",
    );
    expect(code).toContain("  NestingType,");
  });

  it("emits a custom shouldComplete predicate", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "cfg2",
      dependencyMode: "dag",
      dagConfig: {
        completionConfig: {
          shouldComplete:
            "status.successCount >= 3 ? { complete: true } : { complete: false }",
        },
      },
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "a", code: "return 1;" },
      ],
      edges: [{ id: "e1", source: "s", target: "a" }],
    };
    const code = generateHandler(wf);
    expect(code).toContain(
      "completionConfig: { shouldComplete: (status) => status.successCount >= 3",
    );
  });
});

describe("dag aggregate result return (P2.10, §5)", () => {
  it("returns the DagResult const — a DAG has no end node", () => {
    // A DAG completes by draining / its completion policy and yields its
    // aggregate DagResult; there is no end-node return in a DAG. The scope
    // returns `result` regardless of any end node.
    const wf = diamond();
    wf.nodes = wf.nodes.filter((n) => n.kind !== "end");
    wf.edges = wf.edges.filter((e) => e.target !== "e");
    const code = generateHandler(wf);
    expect(code).toContain("return result;");
    expect(code).not.toContain('kind: "end"');
  });
});

describe("other task kinds in dag mode (P2.4)", () => {
  it("chainInvoke → dag.invoke(name, arn, deps, payloadFn) — deps is arg 3", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "inv",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "a", code: "return 1;" },
        {
          id: "b",
          kind: "chainInvoke",
          name: "call",
          functionArn: "arn:aws:lambda:x",
          payload: "{ from: a }",
        } as never,
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "e2", source: "a", target: "b" },
      ],
    };
    const code = generateHandler(wf);
    expect(code).toContain(
      'dag.invoke("call", "arn:aws:lambda:x", [a], (deps) => {',
    );
    expect(code).toContain('const a = deps["a"];');
    expect(code).toContain("return { from: a };");
  });

  it("wait → dag.wait(name, deps, duration)", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "w",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "w",
          kind: "wait",
          name: "cool",
          durationValue: 30,
          durationUnit: "seconds",
        } as never,
      ],
      edges: [{ id: "e1", source: "s", target: "w" }],
    };
    const code = generateHandler(wf);
    expect(code).toContain(
      'const cool = dag.wait("cool", [], { seconds: 30 });',
    );
  });

  it("group with linear body binds a handle usable as a dep", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "g",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "g",
          kind: "group",
          name: "grp",
          body: {
            darVersion: "1.0",
            name: "b",
            dependencyMode: "linear",
            nodes: [
              { id: "bs", kind: "start", name: "start" },
              { id: "x", kind: "step", name: "x", code: "return 1;" },
            ],
            edges: [{ id: "be", source: "bs", target: "x" }],
          },
        } as never,
      ],
      edges: [{ id: "e1", source: "s", target: "g" }],
    };
    const code = generateHandler(wf);
    expect(code).toContain(
      'const grp = dag.runInChildContext("grp", [], async (childCtx) => {',
    );
  });
});
