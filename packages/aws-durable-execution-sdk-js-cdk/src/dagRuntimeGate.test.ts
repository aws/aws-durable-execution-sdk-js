import { generateHandler } from "./generateHandler";
import type { DarWorkflow } from "./darModel";

/**
 * DAG codegen emits an API the runtime SDK does not implement: `context.dag(...)`,
 * the `dag.*` task builders, `.after()`, `.triggerRule()`, the `deps` closure
 * parameter, and the `DagResult` returned at the end. (`NestingType` does exist;
 * nothing else on that list does.)
 *
 * Nothing downstream catches it. `NodejsFunction` bundles with esbuild, which
 * transpiles without typechecking, so synth and bundle both succeed and the
 * failure appears only when the deployed function is invoked, as
 * `TypeError: context.dag is not a function`. The DAG codegen tests assert on
 * generated STRINGS, so they stay green as well — which is why two shipped
 * starter packs could offer an undeployable workflow.
 *
 * The gate lives in `emitDagRegistrations`, the only function that emits dag task
 * registrations, so no caller can miss it. It was first placed on `emitDagScope`
 * on the belief that every dag path went through there — which was wrong: the
 * LINEAR emitter's `dagContainer` arm calls `emitDagRegistrations` directly, so a
 * linear workflow with one `dagContainer` dragged from the palette emitted
 * `context.dag(...)` and sailed straight past the gate. The last test below is
 * that regression.
 *
 * These tests should be DELETED when the dag runtime lands — and replaced with
 * one that invokes a generated handler against the real SDK, which is the check
 * that would have caught this in the first place.
 */
function wf(dependencyMode: "linear" | "dag"): DarWorkflow {
  return {
    darVersion: "1",
    name: "gated",
    dependencyMode,
    nodes: [
      { id: "a", kind: "step", name: "A", code: "return 1;", terminal: true },
    ],
    edges: [],
  } as unknown as DarWorkflow;
}

describe("dag runtime gate", () => {
  const hadEnv = process.env.DAR_ALLOW_DAG_MODE;
  beforeEach(() => {
    delete process.env.DAR_ALLOW_DAG_MODE;
  });
  afterAll(() => {
    if (hadEnv !== undefined) process.env.DAR_ALLOW_DAG_MODE = hadEnv;
  });

  it("refuses to generate a dag workflow by default", () => {
    expect(() => generateHandler(wf("dag"))).toThrow(/cannot be deployed yet/);
  });

  it("names the runtime failure the user would otherwise hit", () => {
    expect(() => generateHandler(wf("dag"))).toThrow(
      /context\.dag is not a function/,
    );
  });

  it("never emits the nonexistent API when refusing", () => {
    let emitted: string | undefined;
    try {
      emitted = generateHandler(wf("dag"));
    } catch {
      emitted = undefined;
    }
    expect(emitted).toBeUndefined();
  });

  it("allows dag when explicitly opted in, for developing against the runtime", () => {
    const code = generateHandler(wf("dag"), { allowDagMode: true });
    expect(code).toContain("context.dag(");
  });

  it("also honors the environment opt-in, for tests and scripts", () => {
    process.env.DAR_ALLOW_DAG_MODE = "1";
    expect(generateHandler(wf("dag"))).toContain("context.dag(");
  });

  it("gates a dagContainer inside a LINEAR workflow", () => {
    // The path that bypassed the original placement entirely.
    const withContainer = {
      darVersion: "1",
      name: "gated",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "d",
          kind: "dagContainer",
          name: "DC",
          terminal: true,
          body: {
            dependencyMode: "dag",
            nodes: [
              { id: "i", kind: "step", name: "Inner", code: "return 1;" },
            ],
            edges: [],
          },
        },
      ],
      edges: [{ id: "e", source: "s", target: "d" }],
    } as unknown as DarWorkflow;
    expect(() => generateHandler(withContainer)).toThrow(
      /cannot be deployed yet/,
    );
    expect(generateHandler(withContainer, { allowDagMode: true })).toContain(
      "context.dag(",
    );
  });

  it("leaves linear mode completely untouched", () => {
    const code = generateHandler(wf("linear"));
    expect(code).toContain('context.step("A"');
    expect(code).not.toContain("context.dag(");
    expect(code).not.toContain("dag.step(");
  });
});
