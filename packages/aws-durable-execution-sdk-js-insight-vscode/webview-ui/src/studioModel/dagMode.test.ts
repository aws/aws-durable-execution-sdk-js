/**
 * Tests for the Phase 3 DAG model additions: the per-scope dependency-mode
 * toggle helper, parse round-tripping of the new fields (edge.dependencyKind,
 * node.triggerRule/runIf, workflow.dagConfig), and the linear/dag gating
 * predicates that the inspector uses to show/hide the DAG task section.
 */
import {
  isDagWorkflow,
  isLinearWorkflow,
  isOperationKind,
  parseWorkflow,
  setWorkflowDependencyMode,
} from "./model";
import { validateWorkflow } from "./validation";
import type { DarWorkflow } from "./model";

const has = (msgs: { message: string }[], re: RegExp) =>
  msgs.some((m) => re.test(m.message));

/** A small diamond: start → a → {b,c} → d, with d fanning in from b and c. */
function diamond(mode: "linear" | "dag"): DarWorkflow {
  return parseWorkflow({
    name: "t",
    dependencyMode: mode,
    nodes: [
      { id: "s", kind: "start", name: "start" },
      { id: "a", kind: "step", name: "a" },
      { id: "b", kind: "step", name: "b" },
      { id: "c", kind: "step", name: "c" },
      { id: "d", kind: "step", name: "d", terminal: true },
    ],
    edges: [
      { id: "e0", source: "s", target: "a" },
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "a", target: "c" },
      { id: "e3", source: "b", target: "d" },
      { id: "e4", source: "c", target: "d" },
    ],
  });
}

describe("setWorkflowDependencyMode", () => {
  it("flips the mode without touching edges", () => {
    const dag = diamond("dag");
    const toLinear = setWorkflowDependencyMode(dag, "linear");
    expect(isLinearWorkflow(toLinear)).toBe(true);
    // Edges are preserved (no silent deletion on toggle).
    expect(toLinear.edges).toHaveLength(dag.edges.length);
    expect(toLinear.edges.map((e) => e.id).sort()).toEqual(
      dag.edges.map((e) => e.id).sort(),
    );
  });

  it("returns the same object when already in the target mode", () => {
    const dag = diamond("dag");
    expect(setWorkflowDependencyMode(dag, "dag")).toBe(dag);
  });

  it("round-trips linear -> dag -> linear", () => {
    const lin = diamond("linear");
    const back = setWorkflowDependencyMode(
      setWorkflowDependencyMode(lin, "dag"),
      "linear",
    );
    expect(isLinearWorkflow(back)).toBe(true);
    expect(back.edges).toHaveLength(lin.edges.length);
  });
});

describe("linear/dag gating predicates (inspector field gate)", () => {
  it("isDagWorkflow / isLinearWorkflow reflect the mode", () => {
    expect(isDagWorkflow(diamond("dag"))).toBe(true);
    expect(isDagWorkflow(diamond("linear"))).toBe(false);
    expect(isLinearWorkflow(diamond("linear"))).toBe(true);
  });

  it("defaults to linear (dag UI hidden) when dependencyMode is absent", () => {
    const wf = parseWorkflow({
      name: "t",
      nodes: [{ id: "s", kind: "start", name: "start" }],
      edges: [],
    });
    // parseWorkflow normalizes absent -> "linear", so the DAG task section
    // (gated on dag mode) stays hidden by default.
    expect(isDagWorkflow(wf)).toBe(false);
  });

  it("gate = dag mode AND operation kind (start/end excluded)", () => {
    // The inspector shows the DAG task section only for operation kinds in dag
    // mode; start/end are structural and never get it.
    expect(isOperationKind("step")).toBe(true);
    expect(isOperationKind("start")).toBe(false);
    expect(isOperationKind("end")).toBe(false);
  });
});

describe("validateWorkflow fan-in on mode toggle", () => {
  it("dag mode allows fan-in with no 1:1 errors", () => {
    const issues = validateWorkflow(diamond("dag"));
    expect(has(issues, /next nodes/)).toBe(false);
    expect(has(issues, /incoming connections/)).toBe(false);
  });

  it("switching the diamond to linear warns on fan-in and errors on fan-out", () => {
    const lin = setWorkflowDependencyMode(diamond("dag"), "linear");
    const issues = validateWorkflow(lin);
    // "a" fans out to b and c → 1:1 fan-out error.
    expect(
      issues.some((i) => i.nodeId === "a" && /next nodes/.test(i.message)),
    ).toBe(true);
    // "d" fans in from b and c → 1:1 fan-in warning (not a silent delete).
    expect(
      issues.some(
        (i) =>
          i.nodeId === "d" &&
          i.level === "warning" &&
          /incoming connections/.test(i.message),
      ),
    ).toBe(true);
  });

  it("does not count condition-branch convergence as fan-in", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "c", kind: "condition", name: "cond" },
        { id: "j", kind: "step", name: "join", terminal: true },
      ],
      edges: [
        { id: "e0", source: "s", target: "c" },
        { id: "e1", source: "c", target: "j", match: "A" },
        { id: "e2", source: "c", target: "j", match: "B" },
      ],
    });
    // Two condition branches converge on "join" — legitimate in linear mode.
    expect(
      validateWorkflow(wf).some(
        (i) => i.nodeId === "j" && /incoming connections/.test(i.message),
      ),
    ).toBe(false);
  });
});

describe("parseWorkflow DAG fields", () => {
  it("preserves edge.dependencyKind='ordering' and drops the default", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "a" },
        { id: "b", kind: "step", name: "b", terminal: true },
      ],
      edges: [
        { id: "e0", source: "s", target: "a" },
        { id: "e1", source: "a", target: "b", dependencyKind: "ordering" },
      ],
    });
    const ordering = wf.edges.find((e) => e.id === "e1")!;
    expect(ordering.dependencyKind).toBe("ordering");
    // A "result" (default) edge stores no dependencyKind.
    const start = wf.edges.find((e) => e.id === "e0")!;
    expect(start.dependencyKind).toBeUndefined();
  });

  it("preserves node.triggerRule and node.runIf", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "a",
          kind: "step",
          name: "a",
          terminal: true,
          triggerRule: "ANY_SUCCESS",
          runIf: 'deps["x"] === 1',
        },
      ],
      edges: [{ id: "e0", source: "s", target: "a" }],
    });
    const a = wf.nodes.find((n) => n.id === "a") as unknown as Record<
      string,
      unknown
    >;
    expect(a.triggerRule).toBe("ANY_SUCCESS");
    expect(a.runIf).toBe('deps["x"] === 1');
  });

  it("preserves workflow.dagConfig (threshold and custom forms)", () => {
    const threshold = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      dagConfig: {
        maxConcurrency: 8,
        defaultTriggerRule: "NONE_FAILED",
        nesting: "FLAT",
        completionConfig: { minSuccessful: 3 },
      },
      nodes: [{ id: "s", kind: "start", name: "start" }],
      edges: [],
    });
    expect(threshold.dagConfig).toEqual({
      maxConcurrency: 8,
      defaultTriggerRule: "NONE_FAILED",
      nesting: "FLAT",
      completionConfig: { minSuccessful: 3 },
    });

    const custom = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      dagConfig: {
        completionConfig: { shouldComplete: "status.succeeded > 2" },
      },
      nodes: [{ id: "s", kind: "start", name: "start" }],
      edges: [],
    });
    expect(custom.dagConfig?.completionConfig).toEqual({
      shouldComplete: "status.succeeded > 2",
    });
  });

  it("omits dagConfig when absent", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [{ id: "s", kind: "start", name: "start" }],
      edges: [],
    });
    expect(wf.dagConfig).toBeUndefined();
  });
});
