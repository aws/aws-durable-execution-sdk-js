import { parseWorkflow } from "./model";
import { validateWorkflow } from "./validation";

const has = (msgs: { message: string }[], re: RegExp) =>
  msgs.some((m) => re.test(m.message));

describe("validateWorkflow", () => {
  it("does not flag a valid dag scope with a leaf task for no-end / no-next-node", () => {
    // A DAG has no end node and its leaf tasks have no outgoing edge — both are
    // legitimate. seed -> {a, b}; a and b are leaves.
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "seed", kind: "step", name: "seed", code: "return 1;" },
        { id: "a", kind: "step", name: "a", code: "return seed + 1;" },
        { id: "b", kind: "step", name: "b", code: "return seed + 2;" },
      ],
      edges: [
        { id: "e1", source: "s", target: "seed" },
        { id: "e2", source: "seed", target: "a" },
        { id: "e3", source: "seed", target: "b" },
      ],
    });
    const issues = validateWorkflow(wf);
    expect(has(issues, /no end/)).toBe(false);
    expect(has(issues, /has no next node/)).toBe(false);
  });

  it("still warns on a missing end and errors on no-next-node in a linear scope", () => {
    // Linear scope: step1 has no outgoing edge and there is no end node.
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "step1" },
      ],
      edges: [{ id: "e1", source: "s", target: "a" }],
    });
    const issues = validateWorkflow(wf);
    expect(has(issues, /no end/)).toBe(true);
    expect(
      issues.some(
        (i) => i.nodeId === "a" && /has no next node/.test(i.message),
      ),
    ).toBe(true);
  });

  it("warns (defensively) when a dag scope contains an end node", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "step1", code: "return 1;" },
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "e2", source: "a", target: "e" },
      ],
    });
    expect(has(validateWorkflow(wf), /end nodes are not used in a DAG/)).toBe(
      true,
    );
  });

  it("gives NO 'no start' error for a valid dag scope with no start node", () => {
    // A dag scope has no start node — a root is a task with no deps. Two
    // independent roots + a join is completely valid.
    const wf = parseWorkflow({
      name: "t",
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
    });
    const issues = validateWorkflow(wf);
    expect(has(issues, /no start node/)).toBe(false);
    expect(has(issues, /more than one start node/)).toBe(false);
    // The roots (a, b) must not be flagged for "no previous node" either.
    expect(has(issues, /no previous node/)).toBe(false);
  });

  it("warns (defensively) when a dag scope contains a start node", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "step1", code: "return 1;" },
      ],
      edges: [{ id: "e1", source: "s", target: "a" }],
    });
    expect(has(validateWorkflow(wf), /start nodes are not used in a DAG/)).toBe(
      true,
    );
  });

  it("reports missing start and a lone node with no previous/next", () => {
    const wf = parseWorkflow({
      name: "t",
      nodes: [{ id: "a", kind: "step", name: "step1" }],
      edges: [],
    });
    const issues = validateWorkflow(wf);
    expect(has(issues, /no start node/)).toBe(true);
  });

  it("does not flag an error-route target as having no previous node", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "step1" },
        { id: "h", kind: "step", name: "handler", terminal: true },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "b1", source: "a", target: "h", kind: "error" },
      ],
    });
    const issues = validateWorkflow(wf);
    // "h" is reached only via the error route — must not be "no previous node".
    expect(
      issues.some(
        (i) => i.nodeId === "h" && /no previous node/.test(i.message),
      ),
    ).toBe(false);
    // ...and it should be considered reachable from start.
    expect(
      issues.some(
        (i) => i.nodeId === "h" && /not reachable from start/.test(i.message),
      ),
    ).toBe(false);
  });

  it("exempts error edges from the linear 1:1 fan-out rule", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "step1" },
        { id: "b", kind: "step", name: "next", terminal: true },
        { id: "h", kind: "step", name: "handler", terminal: true },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "e2", source: "a", target: "b" },
        { id: "b1", source: "a", target: "h", kind: "error" },
      ],
    });
    expect(has(validateWorkflow(wf), /has 2 next nodes/)).toBe(false);
  });

  it("counts catch-alls across error edges and fallback branches", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "a",
          kind: "step",
          name: "step1",
          onError: [{ id: "f1", fallbackCode: "return null;" }],
        },
        { id: "h", kind: "step", name: "handler", terminal: true },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "b1", source: "a", target: "h", kind: "error" },
      ],
    });
    expect(has(validateWorkflow(wf), /2 catch-all error branches/)).toBe(true);
  });

  it("flags duplicate operation names", () => {
    const wf = parseWorkflow({
      name: "t",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "dup" },
        { id: "b", kind: "step", name: "dup" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "e2", source: "a", target: "b" },
      ],
    });
    expect(has(validateWorkflow(wf), /Duplicate node name "dup"/)).toBe(true);
  });

  it("flags >1 next in a linear workflow but allows an error route", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "a",
          kind: "step",
          name: "step1",
          onError: [{ id: "b1", target: "h" }],
        },
        { id: "h", kind: "step", name: "handler", terminal: true },
      ],
      edges: [{ id: "e1", source: "s", target: "a" }],
    });
    // The error route is not a "next" — no 1:1 violation on "a".
    expect(
      validateWorkflow(wf).some(
        (i) => i.nodeId === "a" && /next nodes/.test(i.message),
      ),
    ).toBe(false);
  });

  it("flags two names that sanitize to the same identifier", () => {
    const wf = parseWorkflow({
      name: "t",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "my step" },
        { id: "b", kind: "step", name: "my-step" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "e2", source: "a", target: "b" },
      ],
    });
    expect(has(validateWorkflow(wf), /same identifier "my_step"/)).toBe(true);
  });

  it("flags a name that maps to a reserved identifier", () => {
    const wf = parseWorkflow({
      name: "t",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "event", terminal: true },
      ],
      edges: [{ id: "e1", source: "s", target: "a" }],
    });
    expect(has(validateWorkflow(wf), /reserved identifier "event"/)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — DAG-scope validation rules (§4.1–4.4, §8). Each is gated on a dag
// scope (dependencyMode: "dag"); a dagContainer body is validated as such a
// scope, so these fire there too.
// ---------------------------------------------------------------------------
describe("validateWorkflow DAG rules", () => {
  // (1) inline is forbidden in a dag scope (§4.2).
  it("errors on an inline node in a dag scope", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "i", kind: "inline", name: "compute", code: "return 1;" },
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [
        { id: "e0", source: "s", target: "i" },
        { id: "e1", source: "i", target: "e" },
      ],
    });
    expect(has(validateWorkflow(wf), /inline is not supported in a DAG/)).toBe(
      true,
    );
  });

  it("does NOT flag inline in a linear scope", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "i", kind: "inline", name: "compute", code: "return 1;" },
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [
        { id: "e0", source: "s", target: "i" },
        { id: "e1", source: "i", target: "e" },
      ],
    });
    expect(has(validateWorkflow(wf), /inline is not supported in a DAG/)).toBe(
      false,
    );
  });

  // (2) Typed error edge forbidden in a dag scope; untyped (catch-all) allowed.
  it("errors on a TYPED error edge in a dag scope", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "a" },
        { id: "h", kind: "step", name: "handler" },
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [
        { id: "e0", source: "s", target: "a" },
        { id: "b1", source: "a", target: "h", kind: "error", errorType: "Foo" },
        { id: "e1", source: "h", target: "e" },
      ],
    });
    expect(
      has(validateWorkflow(wf), /typed error routes aren’t supported in a DAG/),
    ).toBe(true);
  });

  it("allows an UNTYPED (catch-all) error edge in a dag scope", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "a" },
        { id: "h", kind: "step", name: "handler" },
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [
        { id: "e0", source: "s", target: "a" },
        { id: "b1", source: "a", target: "h", kind: "error" },
        { id: "e1", source: "h", target: "e" },
      ],
    });
    expect(
      has(validateWorkflow(wf), /typed error routes aren’t supported in a DAG/),
    ).toBe(false);
  });

  // (3) Reading the result of an ordering-only dependency (§8).
  it("errors when a task reads deps[...] of an ordering-only dependency", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "a" },
        { id: "b", kind: "step", name: "b", code: 'return deps["a"];' },
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [
        { id: "e0", source: "s", target: "a" },
        { id: "e1", source: "a", target: "b", dependencyKind: "ordering" },
        { id: "e2", source: "b", target: "e" },
      ],
    });
    expect(has(validateWorkflow(wf), /ordering-only/)).toBe(true);
  });

  it("does NOT flag reading a RESULT dependency's deps[...]", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "a" },
        { id: "b", kind: "step", name: "b", code: 'return deps["a"];' },
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [
        { id: "e0", source: "s", target: "a" },
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "e" },
      ],
    });
    expect(has(validateWorkflow(wf), /ordering-only/)).toBe(false);
  });

  // (4) runIf / triggerRule referencing a non-dependency (§8).
  it("errors when runIf references a non-dependency task", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "a",
          kind: "step",
          name: "a",
          runIf: 'deps["ghost"] === 1',
        },
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [
        { id: "e0", source: "s", target: "a" },
        { id: "e1", source: "a", target: "e" },
      ],
    });
    expect(
      has(
        validateWorkflow(wf),
        /runIf references "ghost" which is not a dependency/,
      ),
    ).toBe(true);
  });

  it("does NOT flag runIf that references a real result dependency", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "up", kind: "step", name: "up" },
        {
          id: "a",
          kind: "step",
          name: "a",
          runIf: 'deps["up"] === 1',
        },
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [
        { id: "e0", source: "s", target: "up" },
        { id: "e1", source: "up", target: "a" },
        { id: "e2", source: "a", target: "e" },
      ],
    });
    expect(has(validateWorkflow(wf), /is not a dependency/)).toBe(false);
  });

  it("errors on an unknown triggerRule value", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "a", triggerRule: "SOMETIMES" },
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [
        { id: "e0", source: "s", target: "a" },
        { id: "e1", source: "a", target: "e" },
      ],
    });
    expect(has(validateWorkflow(wf), /unknown trigger rule "SOMETIMES"/)).toBe(
      true,
    );
  });

  // (5) completionConfig custom vs threshold mutual exclusivity (§8).
  it("errors when completionConfig mixes shouldComplete and threshold fields", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      dagConfig: {
        completionConfig: {
          shouldComplete: "status.succeeded > 2",
          minSuccessful: 3,
        },
      },
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "a" },
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [
        { id: "e0", source: "s", target: "a" },
        { id: "e1", source: "a", target: "e" },
      ],
    });
    expect(has(validateWorkflow(wf), /mutually exclusive/)).toBe(true);
  });

  it("does NOT flag a threshold-only or custom-only completionConfig", () => {
    const threshold = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      dagConfig: { completionConfig: { minSuccessful: 3 } },
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "a" },
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [
        { id: "e0", source: "s", target: "a" },
        { id: "e1", source: "a", target: "e" },
      ],
    });
    const custom = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      dagConfig: { completionConfig: { shouldComplete: "status.done" } },
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "a" },
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [
        { id: "e0", source: "s", target: "a" },
        { id: "e1", source: "a", target: "e" },
      ],
    });
    expect(has(validateWorkflow(threshold), /mutually exclusive/)).toBe(false);
    expect(has(validateWorkflow(custom), /mutually exclusive/)).toBe(false);
  });

  // (6) Condition re-convergence warning (§4.1).
  it("warns when a default-rule task re-converges two branches of one condition", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "c", kind: "condition", name: "cond", code: 'return "A";' },
        { id: "b1", kind: "step", name: "branchA" },
        { id: "b2", kind: "step", name: "branchB" },
        { id: "j", kind: "step", name: "join" },
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [
        { id: "e0", source: "s", target: "c" },
        { id: "e1", source: "c", target: "b1", match: "A" },
        { id: "e2", source: "c", target: "b2", match: "B" },
        { id: "e3", source: "b1", target: "j" },
        { id: "e4", source: "b2", target: "j" },
        { id: "e5", source: "j", target: "e" },
      ],
    });
    const issues = validateWorkflow(wf);
    expect(
      issues.some(
        (i) =>
          i.nodeId === "j" &&
          i.level === "warning" &&
          /reachable from multiple branches/.test(i.message),
      ),
    ).toBe(true);
  });

  it("does NOT warn on re-convergence when the join uses ANY_SUCCESS", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "c", kind: "condition", name: "cond", code: 'return "A";' },
        { id: "b1", kind: "step", name: "branchA" },
        { id: "b2", kind: "step", name: "branchB" },
        { id: "j", kind: "step", name: "join", triggerRule: "ANY_SUCCESS" },
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [
        { id: "e0", source: "s", target: "c" },
        { id: "e1", source: "c", target: "b1", match: "A" },
        { id: "e2", source: "c", target: "b2", match: "B" },
        { id: "e3", source: "b1", target: "j" },
        { id: "e4", source: "b2", target: "j" },
        { id: "e5", source: "j", target: "e" },
      ],
    });
    expect(has(validateWorkflow(wf), /reachable from multiple branches/)).toBe(
      false,
    );
  });

  // (7) Two result dependencies whose names collide after sanitizing (§4.4).
  it("errors when two incoming result deps sanitize to the same identifier", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "x", kind: "step", name: "my step" },
        { id: "y", kind: "step", name: "my-step" },
        { id: "j", kind: "step", name: "join" },
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [
        { id: "e0", source: "s", target: "x" },
        { id: "e1", source: "s", target: "y" },
        { id: "e2", source: "x", target: "j" },
        { id: "e3", source: "y", target: "j" },
        { id: "e4", source: "j", target: "e" },
      ],
    });
    expect(
      has(validateWorkflow(wf), /same injected identifier "my_step"/),
    ).toBe(true);
  });

  // (8) A legal root task with no incoming edge is NOT flagged in a dag scope.
  it("does NOT flag a dag root task that has no incoming edge", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "root", kind: "step", name: "root" },
        { id: "e", kind: "end", name: "end" },
      ],
      // `root` has NO incoming edge — a legitimate deps:[] root in dag mode.
      edges: [{ id: "e1", source: "root", target: "e" }],
    });
    expect(
      validateWorkflow(wf).some(
        (i) => i.nodeId === "root" && /no previous node/.test(i.message),
      ),
    ).toBe(false);
  });

  it("STILL flags a linear non-start node with no incoming edge", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "root", kind: "step", name: "root" },
        { id: "e", kind: "end", name: "end" },
      ],
      edges: [{ id: "e1", source: "root", target: "e" }],
    });
    expect(
      validateWorkflow(wf).some(
        (i) => i.nodeId === "root" && /no previous node/.test(i.message),
      ),
    ).toBe(true);
  });

  // A valid diamond dag scope produces no issues at all (no new false
  // positives). A DAG has no start node — `a` is the root task; no end node —
  // `d` is the leaf task.
  it("produces no issues for a valid diamond dag scope", () => {
    const wf = parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "a", kind: "step", name: "a" },
        { id: "b", kind: "step", name: "b" },
        { id: "c", kind: "step", name: "c" },
        { id: "d", kind: "step", name: "d" },
      ],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "a", target: "c" },
        { id: "e3", source: "b", target: "d" },
        { id: "e4", source: "c", target: "d" },
      ],
    });
    expect(validateWorkflow(wf)).toEqual([]);
  });
});

/**
 * An API call's query/headers/body become JS value expressions, so a plain text
 * field can hide two mistakes that only surface after deploy: `${…}` written
 * inside a quoted JSON string (sent literally), and text that is neither JSON
 * nor a valid expression (breaks the generated handler).
 */
describe("httpCall expression fields", () => {
  const wfWith = (patch: Record<string, unknown>) =>
    parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "a", kind: "step", name: "get-order", code: "return 1;" },
        {
          id: "b",
          kind: "httpCall",
          name: "charge",
          method: "POST",
          url: "https://api.stripe.com/v1/charges",
          ...patch,
        },
      ],
      edges: [{ id: "e1", source: "a", target: "b" }],
    });

  it("flags ${…} used inside a quoted JSON string", () => {
    const issues = validateWorkflow(
      wfWith({ query: '{"customer": "${get_order.id}"}' }),
    );
    expect(issues.some((i) => /sent literally/.test(i.message))).toBe(true);
  });

  it("accepts a direct reference to an upstream result", () => {
    const issues = validateWorkflow(
      wfWith({ query: "{ customer: get_order.id }" }),
    );
    expect(issues.filter((i) => /query/.test(i.message))).toEqual([]);
  });

  it("accepts plain JSON with no references", () => {
    expect(
      validateWorkflow(wfWith({ body: '{ "amount": 100 }' })).filter((i) =>
        /body/.test(i.message),
      ),
    ).toEqual([]);
  });

  // Must never false-positive: the webview bundles no parser and the CSP forbids
  // eval, so this only catches unambiguously broken input. The authoritative
  // parse runs in the generator, on the host.
  it("flags unbalanced brackets", () => {
    const issues = validateWorkflow(wfWith({ headers: "{ oops: [1, 2 }" }));
    expect(issues.some((i) => /unbalanced/.test(i.message))).toBe(true);
  });

  it("accepts expressions a real parser would accept", () => {
    for (const v of [
      "{ customer: get_order.id }",
      "get_order",
      '{ "a": get_order.total * 2, "b": [1, 2] }',
      '{ note: "a } brace inside a string" }',
      "{ tpl: `x ${get_order.id} y` }",
    ]) {
      expect(
        validateWorkflow(wfWith({ query: v })).filter((i) =>
          /query/.test(i.message),
        ),
      ).toEqual([]);
    }
  });

  it("ignores empty fields", () => {
    expect(
      validateWorkflow(wfWith({ query: "", headers: "   " })).filter((i) =>
        /query|headers/.test(i.message),
      ),
    ).toEqual([]);
  });

  it("allows ${…} in the url, where it does interpolate", () => {
    const issues = validateWorkflow(
      wfWith({ url: "https://api.x.com/v1/o/${get_order}" }),
    );
    expect(issues.some((i) => /sent literally/.test(i.message))).toBe(false);
  });
});

describe("wait dynamic duration", () => {
  const wfWith = (durationCode: string) =>
    parseWorkflow({
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "a", kind: "step", name: "get-order", code: "return 1;" },
        { id: "b", kind: "wait", name: "cooldown", durationCode },
      ],
      edges: [{ id: "e1", source: "a", target: "b" }],
    });
  const durIssues = (c: string) =>
    validateWorkflow(wfWith(c)).filter((i) => /duration/.test(i.message));

  it("accepts a bare expression", () => {
    expect(durIssues("12")).toEqual([]);
    expect(durIssues("get_order.retryAfter * 2")).toEqual([]);
  });

  it("accepts a block that returns", () => {
    expect(durIssues("const x = 3; return x * 2;")).toEqual([]);
  });

  it("flags a block that never returns", () => {
    expect(durIssues("const x = 3;").length).toBe(1);
  });

  it("ignores an empty duration", () => {
    expect(durIssues("")).toEqual([]);
  });
});
