import { generateHandler } from "./generateHandler";
import type { DarWorkflow } from "./darModel";

function wf(nodeExtra: Record<string, unknown>): DarWorkflow {
  return {
    darVersion: "1.0.0",
    name: "t",
    dependencyMode: "linear",
    nodes: [
      { id: "s", kind: "start", name: "start" },
      {
        id: "a",
        kind: "step",
        name: "fetch",
        code: "return { orderId: '1' };",
        ...nodeExtra,
      } as DarWorkflow["nodes"][number],
      { id: "e", kind: "end", name: "end" },
    ],
    edges: [
      { id: "e1", source: "s", target: "a" },
      { id: "e2", source: "a", target: "e" },
    ],
  };
}

describe("typed results", () => {
  it("annotates the result const with the node's resultType", () => {
    const src = generateHandler(wf({ resultType: "{ orderId: string }" }));
    expect(src).toContain(
      "const fetch: ({ orderId: string }) = await context.step(",
    );
  });

  it("emits a typed let when the node has error branches", () => {
    const src = generateHandler(
      wf({
        resultType: "OrderResult",
        onError: [{ id: "b1", fallbackCode: "return null;" }],
      }),
    );
    expect(src).toContain("let fetch: (OrderResult);");
  });

  it("omits the annotation when no resultType is set", () => {
    const src = generateHandler(wf({}));
    expect(src).toContain("const fetch = await context.step(");
  });
});
