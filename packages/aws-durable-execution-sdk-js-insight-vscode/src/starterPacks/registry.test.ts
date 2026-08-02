import {
  STARTER_PACKS,
  deployStarterPackInfra,
  type StarterPackId,
} from "./registry";

describe("starter pack registry", () => {
  const ALL_PACK_IDS: StarterPackId[] = [
    "hl",
    "tt",
    "cbt",
    "jsp",
    "dpp",
    "ebce",
    "bpc",
  ];

  it("has metadata for every starter pack id", () => {
    for (const id of ALL_PACK_IDS) {
      const metadata = STARTER_PACKS[id];
      expect(metadata).toBeDefined();
      expect(metadata.id).toBe(id);
      expect(metadata.title.length).toBeGreaterThan(0);
      expect(metadata.description.length).toBeGreaterThan(0);
      expect(metadata.icon.length).toBeGreaterThan(0);
      // resourceSummary is intentionally empty for a pack with no supporting
      // infra (hasInfra: false, e.g. "bpc") - only require it non-empty when
      // the pack actually has infra.
      if (metadata.hasInfra) {
        expect(metadata.resourceSummary.length).toBeGreaterThan(0);
      } else {
        expect(metadata.resourceSummary).toEqual([]);
      }
    }
  });

  it("rejects an unknown pack id before making any AWS calls", async () => {
    await expect(
      deployStarterPackInfra("bogus" as StarterPackId, {
        region: "us-east-1",
        credentials: async () => {
          throw new Error("should not be called for an unknown pack id");
        },
      }),
    ).rejects.toThrow(/Unknown starter pack id/);
  });

  it("resolves a no-infra pack's .dar without making any AWS calls", async () => {
    const result = await deployStarterPackInfra("bpc", {
      region: "us-east-1",
      credentials: async () => {
        throw new Error("should not be called for a pack with no CFN infra");
      },
    });
    expect(result.stackId).toBe("");
    expect(result.dar).not.toContain("{{");
    expect(JSON.parse(result.dar).name).toBe("BedrockPromptChaining");
  });
});
