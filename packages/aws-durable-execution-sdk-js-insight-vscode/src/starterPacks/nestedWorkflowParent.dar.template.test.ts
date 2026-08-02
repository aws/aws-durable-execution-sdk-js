import { resolveNestedWorkflowParentDar } from "./assets/nestedWorkflowParent.dar.template";
import { validateDarJson } from "../agent";

describe("NestedWorkflowParent .dar template", () => {
  it("resolves placeholders and produces a valid .dar", async () => {
    const dar = resolveNestedWorkflowParentDar({
      region: "us-east-1",
      childFunctionArn:
        "arn:aws:lambda:us-east-1:123456789012:function:dummy-child:live",
    });

    expect(dar).not.toContain("{{");

    const { errors } = await validateDarJson(dar);
    expect(errors).toEqual([]);
  }, 30_000);
});
