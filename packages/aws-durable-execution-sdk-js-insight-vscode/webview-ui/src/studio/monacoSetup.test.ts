/**
 * Unit tests for `buildScaffold`'s DAG `deps` support. `monaco-editor` is an
 * AMD bundle that can't be `require`d under Node (jest's env), and
 * `buildScaffold` is a pure string builder that touches none of it, so we stub
 * the module out to import the function in isolation.
 */
jest.mock("monaco-editor", () => ({}));

// eslint-disable-next-line import/first
import { buildScaffold } from "./monacoSetup";

describe("buildScaffold — DAG deps declaration", () => {
  it("emits `declare const deps: {…}` when depsType is provided, plus bare const aliases", () => {
    const doc = buildScaffold(
      "step",
      ["A"],
      { A: "number" },
      undefined,
      'return deps["A"];',
      '{ "A": number }',
    );
    // The typed deps map (so deps["A"] / deps.A type-check + autocomplete).
    expect(doc).toContain('declare const deps: { "A": number };');
    // The bare const alias the shim injects (so bare `A` also works).
    expect(doc).toContain("declare const A: number; // in scope here");
    // Body is preserved between the markers.
    expect(doc).toContain('return deps["A"];');
  });

  it("omits `declare const deps` entirely in linear scopes (no depsType)", () => {
    const doc = buildScaffold(
      "step",
      ["A"],
      { A: "number" },
      undefined,
      "return A;",
    );
    expect(doc).not.toContain("declare const deps");
    // Linear bare-const behavior is unchanged.
    expect(doc).toContain("declare const A: number; // in scope here");
  });

  it("omits `declare const deps` for an empty / whitespace-only depsType", () => {
    const doc = buildScaffold("step", [], {}, undefined, "return 1;", "   ");
    expect(doc).not.toContain("declare const deps");
  });
});
