import { inferResultTypes } from "./inferTypes";

describe("inferResultTypes", () => {
  it("infers an object-literal result type from a step body", () => {
    const out = inferResultTypes(
      [
        {
          nodeId: "n1",
          resultName: "fetch",
          code: "return { orderId: '1', total: 42, ok: true };",
          codeKind: "step",
          scope: [],
        },
      ],
      {},
    );
    expect(out.n1).toBeDefined();
    expect(out.n1).toContain("orderId: string");
    expect(out.n1).toContain("total: number");
    expect(out.n1).toContain("ok: boolean");
  });

  it("feeds an upstream inferred type forward into the next node's scope", () => {
    const out = inferResultTypes(
      [
        {
          nodeId: "n1",
          resultName: "fetch",
          code: "return { orderId: 'x', total: 10 };",
          codeKind: "step",
          scope: [],
        },
        {
          nodeId: "n2",
          resultName: "derive",
          code: "return { id: fetch.orderId, doubled: fetch.total * 2 };",
          codeKind: "step",
          scope: ["fetch"],
        },
      ],
      {},
    );
    expect(out.n2).toContain("id: string");
    expect(out.n2).toContain("doubled: number");
  });

  it("prefers an author-declared seed type when resolving scope", () => {
    const out = inferResultTypes(
      [
        {
          nodeId: "n2",
          resultName: "derive",
          code: "return { city: upstream.address.city };",
          codeKind: "step",
          scope: ["upstream"],
        },
      ],
      { upstream: "{ address: { city: string } }" },
    );
    expect(out.n2).toContain("city: string");
  });

  it("drops results that resolve to any (e.g. untyped SDK calls)", () => {
    const out = inferResultTypes(
      [
        {
          nodeId: "n1",
          resultName: "sdkish",
          code: "return (globalThis as any).client.send();",
          codeKind: "step",
          scope: [],
        },
      ],
      {},
    );
    expect(out.n1).toBeUndefined();
  });

  it("infers array result types", () => {
    const out = inferResultTypes(
      [
        {
          nodeId: "n1",
          resultName: "arr",
          code: "return [1, 2, 3].map((x) => ({ x }));",
          codeKind: "step",
          scope: [],
        },
      ],
      {},
    );
    expect(out.n1).toBeDefined();
    expect(out.n1).toMatch(/x: number/);
  });

  it("ignores invalid code without throwing", () => {
    const out = inferResultTypes(
      [
        {
          nodeId: "n1",
          resultName: "broken",
          code: "return {{{ not valid",
          codeKind: "step",
          scope: [],
        },
      ],
      {},
    );
    expect(out.n1).toBeUndefined();
  });
});
