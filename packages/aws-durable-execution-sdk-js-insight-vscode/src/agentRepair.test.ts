import { repairUndefinedIdentifier, validateDarJson } from "./agent";

/** A workflow whose condition references `fraudCheck` while the node name
 * "fraud-check" sanitizes to `fraud_check` — the classic model mistake. */
const broken = JSON.stringify({
  darVersion: "1.0",
  name: "orders",
  dependencyMode: "linear",
  nodes: [
    { id: "s", kind: "start", name: "start", position: { x: 0, y: 0 } },
    {
      id: "n1",
      kind: "step",
      name: "fraud-check",
      position: { x: 0, y: 130 },
      code: "return { ok: true };",
    },
    {
      id: "n2",
      kind: "inline",
      name: "route",
      position: { x: 0, y: 260 },
      code: "return fraudCheck.ok;",
      terminal: true,
    },
    { id: "n2__end", kind: "end", name: "end", position: { x: 0, y: 390 } },
  ],
  edges: [
    { id: "e1", source: "s", target: "n1" },
    { id: "e2", source: "n1", target: "n2" },
    { id: "e3", source: "n2", target: "n2__end" },
  ],
});

describe("repairUndefinedIdentifier", () => {
  it("rewrites a near-miss reference to the sanitized identifier", () => {
    const fixed = repairUndefinedIdentifier(broken, "fraudCheck");
    expect(fixed).not.toBeNull();
    const wf = JSON.parse(fixed as string);
    const route = wf.nodes.find((n: { id: string }) => n.id === "n2");
    expect(route.code).toBe("return fraud_check.ok;");
  });

  it("returns null when there is no unambiguous match", () => {
    expect(repairUndefinedIdentifier(broken, "somethingElse")).toBeNull();
  });

  it("does not touch substrings of longer identifiers", () => {
    const wf = JSON.parse(broken);
    wf.nodes[2].code = "return fraudCheckExtra + fraudCheck.ok;";
    const fixed = repairUndefinedIdentifier(JSON.stringify(wf), "fraudCheck");
    const route = JSON.parse(fixed as string).nodes.find(
      (n: { id: string }) => n.id === "n2",
    );
    expect(route.code).toBe("return fraudCheckExtra + fraud_check.ok;");
  });
});

describe("validateDarJson + repair end-to-end", () => {
  it("flags the undefined identifier, and the repaired workflow validates", async () => {
    const first = await validateDarJson(broken);
    expect(first.errors.join("\n")).toMatch(/fraudCheck is not defined/);
    const fixed = repairUndefinedIdentifier(
      first.workflow as string,
      "fraudCheck",
    );
    const second = await validateDarJson(fixed as string);
    expect(second.errors).toEqual([]);
  }, 20000);
});

describe("per-block syntax errors", () => {
  const withCode = (code: string, kind = "step") =>
    JSON.stringify({
      darVersion: "1.0",
      name: "t",
      nodes: [
        { id: "s", kind: "start", name: "start", position: { x: 0, y: 0 } },
        {
          id: "n1",
          kind,
          name: "fetch-order",
          position: { x: 0, y: 130 },
          code,
          terminal: true,
        },
        { id: "n1__end", kind: "end", name: "end", position: { x: 0, y: 260 } },
      ],
      edges: [
        { id: "e1", source: "s", target: "n1" },
        { id: "e2", source: "n1", target: "n1__end" },
      ],
    });

  it("attributes a syntax error to the node and field", async () => {
    const { errors } = await validateDarJson(
      withCode("return { unclosed: true;"),
    );
    expect(errors.join("\n")).toMatch(
      /Node "fetch-order" field `code` has a syntax error/,
    );
    expect(errors.join("\n")).not.toContain("<stdin>");
  });

  it("rejects await inside a sync (inline) block", async () => {
    const { errors } = await validateDarJson(
      withCode("return await fetch(1);", "inline"),
    );
    expect(errors.join("\n")).toMatch(/Node "fetch-order" field `code`/);
  });

  it("accepts a valid workflow unchanged", async () => {
    const { errors } = await validateDarJson(withCode("return 1;"));
    expect(errors).toEqual([]);
  }, 20000);
});
