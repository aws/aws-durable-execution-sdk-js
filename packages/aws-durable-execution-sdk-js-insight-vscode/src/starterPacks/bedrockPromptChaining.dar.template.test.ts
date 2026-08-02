import { resolveBedrockPromptChainingDar } from "./assets/bedrockPromptChaining.dar.template";
import { validateDarJson } from "../agent";

describe("BedrockPromptChaining .dar template", () => {
  it("resolves placeholders and produces a valid .dar", async () => {
    const dar = resolveBedrockPromptChainingDar({
      region: "us-east-1",
    });

    expect(dar).not.toContain("{{");

    const { errors } = await validateDarJson(dar);
    expect(errors).toEqual([]);
  }, 30_000);
});
