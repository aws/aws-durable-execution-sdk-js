import type { DarWorkflow } from "./darModel";
import { parseWorkflow } from "./darModel";
import {
  serializeWorkflow,
  WORKFLOW_DAR_FILENAME,
  WORKFLOW_DAR_TAG_KEY,
} from "./darArtifact";

const workflow: DarWorkflow = {
  darVersion: "1.0",
  name: "orders",
  dependencyMode: "linear",
  inputType: "{ orderId: string }",
  nodes: [
    { id: "start", kind: "start", name: "start" },
    {
      id: "price",
      kind: "step",
      name: "price-lookup",
      position: { x: 10, y: 20 },
      code: "return await lookup(event.orderId);",
      onError: [
        { id: "e1", errorType: "NotFound", fallbackCode: "return {};" },
      ],
    },
  ],
  edges: [{ id: "edge1", source: "start", target: "price" }],
};

describe("serializeWorkflow", () => {
  it("keeps the workflow intact (code included) and round-trips", () => {
    const restored = parseWorkflow(JSON.parse(serializeWorkflow(workflow)));
    expect(restored).toEqual(workflow);
    const price = restored.nodes.find((n) => n.id === "price");
    expect(price?.code).toBe("return await lookup(event.orderId);");
    expect(
      (price?.onError as { fallbackCode?: string }[])[0].fallbackCode,
    ).toBe("return {};");
    expect(price?.position).toEqual({ x: 10, y: 20 });
  });

  it("does not mutate the original workflow", () => {
    const before = JSON.stringify(workflow);
    serializeWorkflow(workflow);
    expect(JSON.stringify(workflow)).toBe(before);
  });

  it("exposes stable filename + tag constants", () => {
    expect(WORKFLOW_DAR_FILENAME).toBe("workflow.dar.json");
    expect(WORKFLOW_DAR_TAG_KEY).toBe("workflowStudioDar");
  });
});
