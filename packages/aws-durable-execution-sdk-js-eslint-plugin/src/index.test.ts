import plugin from "./index";

const NAMESPACE = "@aws/durable-functions";
const RULE_NAMES = [
  "no-closure-in-durable-operations",
  "no-nested-durable-operations",
  "no-non-deterministic-outside-step",
];

describe("plugin", () => {
  it("exports the three rules", () => {
    expect(Object.keys(plugin.rules).sort()).toEqual(RULE_NAMES);
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

    it("enables every rule as an error, and only the plugin's rules", () => {
      expect(config.rules).toEqual(
        Object.fromEntries(
          RULE_NAMES.map((r) => [`${NAMESPACE}/${r}`, "error"]),
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
