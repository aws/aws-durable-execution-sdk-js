import { generateHandler } from "./generateHandler";
import type { DarWorkflow } from "./darModel";

/**
 * Regression: `emitChain`'s `visited` set is an "already emitted" marker, and
 * the error-route branch used to be handed the CALLER'S set rather than a fork.
 * A node reachable from a catch was therefore marked emitted and then skipped on
 * the success path, so an ordinary try/recover/rejoin shape emitted the rejoin
 * node ONLY inside the catch — a wrong Lambda for a workflow that looks correct
 * in the Studio. With two labeled routes, the second also lost every node the
 * first had emitted.
 *
 * Error routes are edge-carried: an edge with `kind: "error"` and an optional
 * `errorType` (see `errorEdgesFor`).
 */
function reconvergent(errorTypes: string[]): DarWorkflow {
  const recoverNodes = errorTypes.map((_, i) => ({
    id: `rc${i}`,
    kind: "step",
    name: `Recover${i}`,
    code: `return ${i};`,
  }));
  const errorEdges = errorTypes.map((t, i) => ({
    id: `err${i}`,
    source: "r",
    target: `rc${i}`,
    kind: "error",
    ...(t === "" ? {} : { errorType: t }),
  }));
  const rejoinEdges = errorTypes.map((_, i) => ({
    id: `re${i}`,
    source: `rc${i}`,
    target: "c",
  }));
  return {
    darVersion: "1",
    name: "reconverge",
    dependencyMode: "linear",
    nodes: [
      { id: "s", kind: "start", name: "start" },
      { id: "r", kind: "step", name: "Risky", code: "return 1;" },
      ...recoverNodes,
      {
        id: "c",
        kind: "step",
        name: "Common",
        code: "return 3;",
        terminal: true,
      },
    ],
    edges: [
      { id: "e1", source: "s", target: "r" },
      { id: "e2", source: "r", target: "c" },
      ...errorEdges,
      ...rejoinEdges,
    ],
  } as never;
}

/** Everything after the last `} catch (err) {` opener, i.e. the recovery path. */
function catchBody(code: string): string {
  const i = code.indexOf("} catch (err) {");
  return i < 0 ? "" : code.slice(i);
}
function beforeCatch(code: string): string {
  const i = code.indexOf("} catch (err) {");
  return i < 0 ? code : code.slice(0, i);
}

describe("error-route reconvergence", () => {
  it("emits the rejoin node on the success path AND in the catch", () => {
    const code = generateHandler(reconvergent([""]));
    // Once per path — previously only the catch got it.
    expect(code.match(/context\.step\("Common"/g)).toHaveLength(2);
    expect(catchBody(code)).toContain('context.step("Common"');
    // The success path must actually run and return it, not return Risky.
    expect(code).toContain("return Common;");
  });

  it("does not leave the success path returning the failed node", () => {
    const code = generateHandler(reconvergent([""]));
    const success = beforeCatch(code) + code.slice(code.lastIndexOf("}\n"));
    expect(success).not.toMatch(/return Risky;/);
  });

  it("gives each labeled route its own copy of the chain", () => {
    const code = generateHandler(reconvergent(["AError", "BError"]));
    expect(code).toContain('context.step("Recover0"');
    expect(code).toContain('context.step("Recover1"');
    // Both routes plus the success path.
    expect(code.match(/context\.step\("Common"/g)).toHaveLength(3);
  });

  it("still emits a linear chain exactly once when there is no error route", () => {
    const plain: DarWorkflow = {
      darVersion: "1",
      name: "plain",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "A", code: "return 1;" },
        { id: "b", kind: "step", name: "B", code: "return 2;", terminal: true },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "e2", source: "a", target: "b" },
      ],
    } as never;
    const code = generateHandler(plain);
    expect(code.match(/context\.step\("B"/g)).toHaveLength(1);
  });
});

/**
 * The rejoin tail is deliberately emitted TWICE — once inside the catch and once
 * on the success path — because only one path runs at a time. That is the round-1
 * fix. But the catch has to TERMINATE, or at runtime the error path falls out of
 * the catch, reaches the success-path copy, and executes the rejoin nodes a second
 * time.
 *
 * `emitChain` returns a `terminated` flag for exactly this, and the error-route
 * emitter was discarding it (`.lines`) while `emitLinearScope` and the condition
 * path both honour it. Studio-saved workflows are protected by the terminal ->
 * owned-end-node convention; hand-written, LLM-produced and ASL-imported files are
 * not, and `parseWorkflow` is deliberately forgiving.
 */
describe("a recovery branch that rejoins must terminate", () => {
  const wf = {
    darVersion: "1",
    name: "w",
    dependencyMode: "linear",
    nodes: [
      { id: "s", kind: "start", name: "start" },
      { id: "a", kind: "step", name: "A", code: "return 1;" },
      { id: "r", kind: "step", name: "R", code: "return 2;" },
      { id: "j", kind: "step", name: "J", code: "return 3;" },
    ],
    edges: [
      { id: "e1", source: "s", target: "a" },
      { id: "e2", source: "a", target: "j" },
      { id: "e3", source: "a", target: "r", kind: "error" },
      { id: "e4", source: "r", target: "j" },
    ],
  } as unknown as Parameters<typeof generateHandler>[0];

  const code = generateHandler(wf);

  it("still emits the rejoin tail on both paths", () => {
    expect((code.match(/const J =/g) ?? []).length).toBe(2);
  });

  it("closes the catch so the error path cannot fall through", () => {
    const catchBlock = code.slice(
      code.indexOf("} catch (err) {"),
      code.indexOf("const J =", code.indexOf("return J;")),
    );
    expect(catchBlock).toContain("return J;");
  });
});
