import { generateHandler } from "./generateHandler";
import type { DarWorkflow } from "./darModel";

function oneStep(inputType?: string): DarWorkflow {
  return {
    darVersion: "1.0",
    name: "t",
    ...(inputType ? { inputType } : {}),
    nodes: [
      { id: "s", kind: "start", name: "start" },
      { id: "a", kind: "step", name: "Step1", code: "return input;" },
    ],
    edges: [{ id: "e1", source: "s", target: "a" }],
  };
}

describe("input typing", () => {
  it("defaults to unknown when no inputType is set", () => {
    const code = generateHandler(oneStep());
    expect(code).toContain("type WorkflowInput = unknown;");
    expect(code).toContain(
      "async (event: WorkflowInput, context: DurableContext) => {",
    );
  });

  it("emits the declared input type and types the handler param", () => {
    const code = generateHandler(
      oneStep("{ orderId: string; amount: number }"),
    );
    expect(code).toContain(
      "type WorkflowInput = { orderId: string; amount: number };",
    );
    expect(code).toContain("async (event: WorkflowInput,");
    expect(code).toContain("const input = event;");
  });
});
