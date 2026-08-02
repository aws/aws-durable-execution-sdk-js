import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateHandler } from "./generateHandler";
import type { DarWorkflow } from "./darModel";

/**
 * `Scope` carries data every emitter frame needs, and building a FRESH scope
 * literal instead of spreading the parent silently drops whatever the builder
 * forgot. This has now caused three separate bugs:
 *
 *  1. The original dag gate hole — the linear `dagContainer` arm built a fresh
 *     literal, so `opts` never reached the gate and DAG code was emitted for a
 *     runtime that does not exist.
 *  2. Six `emitBody` call sites (group/map/parallel in both emitters) did the same,
 *     so a group whose body is dag-mode was refused even with `allowDagMode: true`.
 *  3. Would recur the moment anyone adds a field to `Scope`.
 *
 * Enumerating call sites is what failed each time, so this asserts the invariant
 * structurally rather than testing one more path.
 */
describe("Scope is always inherited, never rebuilt", () => {
  const src = readFileSync(join(__dirname, "generateHandler.ts"), "utf-8");

  it("every scope literal passed to an emitter spreads the parent", () => {
    // A scope literal is recognizable by its `ctxVar:` field. Exactly one is a
    // legitimate root construction (generateHandlerMarked, which has no parent).
    const literals = [
      ...src.matchAll(/\{[^{}]*ctxVar:\s*"[^"]*"[^{}]*\}/g),
    ].map((m) => m[0]);
    const rebuilt = literals.filter((l) => !l.includes("...scope"));
    expect(literals.length).toBeGreaterThan(1);
    // Only the root scope may be built from nothing.
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0]).toContain("opts");
  });
});

describe("generation options reach nested bodies", () => {
  const nested = (kind: string, body: unknown): DarWorkflow =>
    ({
      darVersion: "1",
      name: "w",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "n", kind, name: "N", terminal: true, body },
      ],
      edges: [{ id: "e", source: "s", target: "n" }],
    }) as unknown as DarWorkflow;

  const dagBody = {
    dependencyMode: "dag",
    nodes: [{ id: "i", kind: "step", name: "Inner", code: "return 1;" }],
    edges: [],
  };

  it("honours allowDagMode inside a group body", () => {
    expect(() =>
      generateHandler(nested("group", dagBody), { allowDagMode: true }),
    ).not.toThrow();
  });

  it("still refuses that body without the opt-in", () => {
    expect(() => generateHandler(nested("group", dagBody))).toThrow(
      /cannot be deployed yet/,
    );
  });
});
