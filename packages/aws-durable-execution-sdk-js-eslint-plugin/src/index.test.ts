import plugin from "./index";

const NAMESPACE = "@aws/durable-functions";
const RECOMMENDED_RULE_NAMES = [
  "no-closure-in-durable-operations",
  "no-nested-durable-operations",
  "no-non-deterministic-outside-step",
  "valid-operation-identifiers",
];
const RULE_NAMES = [
  ...RECOMMENDED_RULE_NAMES,
  "require-durable-operation-in-child-context",
];

describe("plugin", () => {
  it("exports the five rules", () => {
    expect(Object.keys(plugin.rules).sort()).toEqual([...RULE_NAMES].sort());
  });

  it("names itself after the package, with the package version", () => {
    // biome-ignore lint/style/noCommonJs: package.json is outside the TypeScript rootDir
    const pkg = require("../package.json");

    expect(plugin.meta).toEqual({ name: pkg.name, version: pkg.version });
  });

  describe('configs["flat/recommended"]', () => {
    const config = plugin.configs["flat/recommended"];

    it("registers the plugin under the namespace the rule names use", () => {
      expect(config.plugins[NAMESPACE]).toBe(plugin);
    });

    it("enables the recommended rules as errors, and no other rule", () => {
      expect(config.rules).toEqual(
        Object.fromEntries(
          RECOMMENDED_RULE_NAMES.map((r) => [`${NAMESPACE}/${r}`, "error"]),
        ),
      );
    });

    it("has a name that identifies the config in ESLint's tooling", () => {
      expect(config.name).toBe(`${plugin.meta.name}/recommended`);
    });
  });

  describe("configs.recommended (legacy)", () => {
    it("keeps the shape and rule names of earlier releases", () => {
      expect(plugin.configs.recommended).toEqual({
        plugins: [NAMESPACE],
        rules: plugin.configs["flat/recommended"].rules,
      });
    });

    it("does not share its rules object with the flat config", () => {
      expect(plugin.configs.recommended.rules).not.toBe(
        plugin.configs["flat/recommended"].rules,
      );
    });
  });
});
