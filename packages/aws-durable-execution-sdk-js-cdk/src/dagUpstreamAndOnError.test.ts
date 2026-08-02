process.env.DAR_ALLOW_DAG_MODE = "1";

import { generateHandler } from "./generateHandler";
import type { DarWorkflow } from "./darModel";

/**
 * Four dag arms produced code that COMPILED and RAN while doing the wrong thing.
 * `group` is the control: it gets the deps shim and the onError try/catch, and is
 * asserted here to still work so these guards can't be mistaken for a blanket ban.
 *
 * None of these are fixed by inventing the missing parameter, because the dag
 * runtime does not exist yet (see dagRuntimeGate.test.ts) and its callback shapes
 * are unsettled. Refusing is what keeps a user from getting code that runs and
 * quietly operates on a task handle. Whoever lands the runtime should decide how
 * deps reach a nested closure, then delete these guards.
 */
const UP = { id: "u", kind: "step", name: "Up", code: "return { s: 1 };" };
const ERR = [{ errorType: "TypeError", fallbackCode: "return 1;" }];
const wf = (node: unknown): DarWorkflow =>
  ({
    darVersion: "1",
    name: "w",
    dependencyMode: "dag",
    nodes: [UP, node],
    edges: [{ id: "e", source: "u", target: (node as { id: string }).id }],
  }) as unknown as DarWorkflow;

const stepBody = (code: string) => ({
  nodes: [{ id: "i", kind: "step", name: "In", code }],
  edges: [],
});

describe("dag upstream results are values, not handles", () => {
  it("refuses an upstream reference in a map iteratee", () => {
    expect(() =>
      generateHandler(
        wf({
          id: "m",
          kind: "map",
          name: "M",
          itemsCode: "return [1];",
          body: stepBody("return Up;"),
        }),
      ),
    ).toThrow(/task handle rather than its value/);
  });

  it("refuses an upstream reference in a parallel branch", () => {
    expect(() =>
      generateHandler(
        wf({
          id: "p",
          kind: "parallel",
          name: "N",
          branches: [{ name: "b1", body: stepBody("return Up;") }],
        }),
      ),
    ).toThrow(/task handle rather than its value/);
  });

  it("refuses an upstream reference in a dynamic wait duration", () => {
    // dag.wait evaluates the expression in the surrounding scope, where the name
    // is the handle — `{ seconds: Up.s }` silently became undefined.
    expect(() =>
      generateHandler(
        wf({
          id: "w",
          kind: "wait",
          name: "W",
          durationCode: "return { seconds: Up.s };",
        }),
      ),
    ).toThrow(/task handle rather than its value/);
  });

  it("still allows a map iteratee that does not reach upstream", () => {
    expect(
      generateHandler(
        wf({
          id: "m",
          kind: "map",
          name: "M",
          itemsCode: "return [1];",
          body: stepBody("return item;"),
        }),
      ),
    ).toContain("dag.map(");
  });

  it("still binds upstream results in a group, which does get deps", () => {
    const code = generateHandler(
      wf({ id: "g", kind: "group", name: "G", body: stepBody("return Up;") }),
    );
    expect(code).toContain('const Up = deps["Up"]');
  });
});

describe("dag onError is not silently dropped", () => {
  it.each([
    [
      "map",
      {
        id: "m",
        kind: "map",
        name: "M",
        itemsCode: "return [1];",
        body: stepBody("return 1;"),
        onError: ERR,
      },
    ],
    [
      "parallel",
      {
        id: "p",
        kind: "parallel",
        name: "N",
        branches: [{ name: "b", body: stepBody("return 1;") }],
        onError: ERR,
      },
    ],
    [
      "wait",
      {
        id: "w",
        kind: "wait",
        name: "W",
        durationCode: "return { seconds: 1 };",
        onError: ERR,
      },
    ],
    [
      "dagContainer",
      {
        id: "d",
        kind: "dagContainer",
        name: "D",
        body: { ...stepBody("return 1;"), dependencyMode: "dag" },
        onError: ERR,
      },
    ],
  ])("refuses onError on a dag %s instead of dropping it", (_kind, node) => {
    // Previously these produced no try/catch at all, so a dag workflow failed
    // where the identical linear workflow recovers.
    expect(() => generateHandler(wf(node))).toThrow(/onError is not supported/);
  });

  it("still emits the try/catch for a group", () => {
    const code = generateHandler(
      wf({
        id: "g",
        kind: "group",
        name: "G",
        body: stepBody("return 1;"),
        onError: ERR,
      }),
    );
    expect(code).toContain("try {");
    expect(code).toContain("err instanceof TypeError");
  });
});
