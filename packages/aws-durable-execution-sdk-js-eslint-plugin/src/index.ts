import { noNestedDurableOperations } from "./rules/no-nested-durable-operations/no-nested-durable-operations";
import { noNonDeterministicOutsideStep } from "./rules/no-non-deterministic-outside-step/no-non-deterministic-outside-step";
import { noClosureInDurableOperations } from "./rules/no-closure-in-durable-operations/no-closure-in-durable-operations";

// package.json sits outside this package's TypeScript rootDir, so it cannot be
// imported as a module. Both dist/index.js and src/index.ts are one directory
// below the package root, so the same relative path resolves from either.
// biome-ignore lint/style/noCommonJs: see the comment above
const { name, version } = require("../package.json") as {
  name: string;
  version: string;
};

const rules = {
  "no-nested-durable-operations": noNestedDurableOperations,
  "no-non-deterministic-outside-step": noNonDeterministicOutsideStep,
  "no-closure-in-durable-operations": noClosureInDurableOperations,
};

/**
 * The namespace the recommended configs register the plugin under.
 *
 * ESLint reports a rule as `<namespace>/<rule>`, and users write that name in
 * `eslint-disable` comments. The namespace is not derived from the package
 * name. It has been `@aws/durable-functions` since the first release, so it
 * stays the same to keep existing rule names valid.
 */
const NAMESPACE = "@aws/durable-functions";

const recommendedRules = {
  [`${NAMESPACE}/no-nested-durable-operations`]: "error",
  [`${NAMESPACE}/no-non-deterministic-outside-step`]: "error",
  [`${NAMESPACE}/no-closure-in-durable-operations`]: "error",
} as const;

/**
 * A flat config object (ESLint's `eslint.config.js` format).
 *
 * Declared here instead of using ESLint's `Linter.Config`. That type means
 * the legacy eslintrc format in ESLint 8 and the flat format in ESLint 9 and
 * later, so using it would give TypeScript users on one of those versions the
 * wrong type.
 */
interface FlatConfig {
  name: string;
  plugins: Record<string, unknown>;
  rules: Record<string, "error">;
}

/** The legacy eslintrc format. See `configs.recommended` below. */
interface LegacyConfig {
  plugins: string[];
  rules: Record<string, "error">;
}

interface DurableExecutionPlugin {
  meta: { name: string; version: string };
  rules: typeof rules;
  configs: {
    /**
     * @deprecated eslintrc configs cannot load this plugin. ESLint turns
     * `@aws/durable-functions` into the package name
     * `@aws/eslint-plugin-durable-functions`, which does not exist, and ESLint
     * 10 removed eslintrc. Use `configs["flat/recommended"]`.
     */
    recommended: LegacyConfig;
    /** All three rules as errors, with the plugin registered. */
    "flat/recommended": FlatConfig;
  };
}

const plugin: DurableExecutionPlugin = {
  // ESLint writes a plugin's meta.name and meta.version into the config it
  // hashes for `--cache`. Without them the hash only contains the namespace, so
  // a cached lint result survives an upgrade of this plugin.
  meta: { name, version },
  rules,
  configs: {
    recommended: {
      plugins: [NAMESPACE],
      rules: recommendedRules,
    },
    // plugins refers to the plugin object itself, so it is filled in below.
    "flat/recommended": {
      name: `${name}/recommended`,
      plugins: {},
      rules: recommendedRules,
    },
  },
};

plugin.configs["flat/recommended"].plugins[NAMESPACE] = plugin;

export = plugin;
