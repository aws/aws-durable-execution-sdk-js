import {
  DEPENDENCY_CODE_FIELDS,
  inferDependencyKind,
  nodeReferencesSource,
} from "./dependencyKind";

describe("inferDependencyKind", () => {
  describe("inference (no explicit override)", () => {
    it('is "result" when the target reads deps["<source>"] (double quotes)', () => {
      const kind = inferDependencyKind({
        targetNode: { code: 'return deps["fetch-users"].length;' },
        sourceName: "fetch-users",
      });
      expect(kind).toBe("result");
    });

    it("is \"result\" when the target reads deps['<source>'] (single quotes)", () => {
      const kind = inferDependencyKind({
        targetNode: { code: "return deps['fetch-users'];" },
        sourceName: "fetch-users",
      });
      expect(kind).toBe("result");
    });

    it('is "result" when the target references the sanitized identifier', () => {
      // "fetch-users" sanitizes to the injected const `fetch_users`.
      const kind = inferDependencyKind({
        targetNode: { code: "return fetch_users.concat(orders);" },
        sourceName: "fetch-users",
      });
      expect(kind).toBe("result");
    });

    it('is "ordering" when the target never references the source', () => {
      const kind = inferDependencyKind({
        targetNode: { code: "return 2;" },
        sourceName: "seed",
      });
      expect(kind).toBe("ordering");
    });

    it("does not match a bare identifier that is only a substring", () => {
      // `seedling` must not count as a reference to `seed`.
      const kind = inferDependencyKind({
        targetNode: { code: "return seedling + 1;" },
        sourceName: "seed",
      });
      expect(kind).toBe("ordering");
    });

    it("scans every code-bearing field, not just `code`", () => {
      const kind = inferDependencyKind({
        targetNode: { payload: "{ from: fetchUsers }" },
        sourceName: "fetchUsers",
      });
      expect(kind).toBe("result");
    });

    it("ignores non-string (e.g. function-reference) fields", () => {
      const kind = inferDependencyKind({
        targetNode: { code: () => undefined, name: "t" },
        sourceName: "seed",
      });
      expect(kind).toBe("ordering");
    });

    it('is "result" when a CONTAINER body references the source (recurses)', () => {
      // A dagContainer/group whose own fields are empty but whose body uses the
      // injected shim identifier must infer "result", not "ordering".
      const kind = inferDependencyKind({
        targetNode: {
          kind: "dagContainer",
          body: {
            nodes: [
              { id: "x", kind: "step", name: "x", code: "return seed + 1;" },
            ],
          },
        },
        sourceName: "seed",
      });
      expect(kind).toBe("result");
    });

    it('is "result" when a PARALLEL branch body references the source', () => {
      const kind = inferDependencyKind({
        targetNode: {
          kind: "parallel",
          branches: [
            {
              body: {
                nodes: [
                  { id: "b", kind: "step", name: "b", code: "return fanIn;" },
                ],
              },
            },
          ],
        },
        sourceName: "fanIn",
      });
      expect(kind).toBe("result");
    });
  });

  describe("explicit override wins both ways", () => {
    it('honors an explicit "ordering" even when the target reads the result', () => {
      const kind = inferDependencyKind({
        targetNode: { code: 'return deps["a"];' },
        sourceName: "a",
        explicit: "ordering",
      });
      expect(kind).toBe("ordering");
    });

    it('honors an explicit "result" even when the target never references it', () => {
      const kind = inferDependencyKind({
        targetNode: { code: "return 1;" },
        sourceName: "a",
        explicit: "result",
      });
      expect(kind).toBe("result");
    });
  });

  describe("nodeReferencesSource", () => {
    it("mirrors the inference predicate", () => {
      expect(nodeReferencesSource({ code: 'deps["x"]' }, "x")).toBe(true);
      expect(nodeReferencesSource({ code: "return 1;" }, "x")).toBe(false);
    });
  });

  it("exposes the scanned field list", () => {
    expect(DEPENDENCY_CODE_FIELDS).toContain("code");
    expect(DEPENDENCY_CODE_FIELDS).toContain("runIf");
  });
});
