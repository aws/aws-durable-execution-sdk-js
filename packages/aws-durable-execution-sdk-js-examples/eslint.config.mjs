import { createRequire } from "module";

const require = createRequire(import.meta.url);

/**
 * ESLint is retained for this package alone, and for exactly one purpose: running
 * the repo's own published lint rules against real code.
 *
 * Everything else in the monorepo is linted and formatted by Biome (see
 * biome.jsonc). Biome cannot host ESLint plugins, and
 * `no-nested-durable-operations` catches a genuine bug class -- a durable
 * operation nested inside a step never checkpoints correctly. The examples are
 * the code customers copy, so this is the one place where dogfooding the plugin
 * has real value. The plugin's own RuleTester unit tests prove the rule works;
 * this proves it works on the code we ship as reference material.
 *
 * Scope is deliberately minimal: no stylistic or TypeScript rules are enabled
 * here, because Biome already owns those. This config registers the plugin and
 * nothing else, so there is no chance of it disagreeing with Biome.
 *
 * NOTE: this requires the plugin to be built first (`dist/index.js`). CI does
 * that in .github/workflows/lint.yml before invoking ESLint.
 */
const durableFunctionsPlugin = require("../aws-durable-execution-sdk-js-eslint-plugin/dist/index.js");
const typescriptParser = require("@typescript-eslint/parser");

export default [
  {
    ignores: [
      "**/coverage/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
    ],
  },
  {
    files: ["src/examples/**/*.ts", "src/examples/**/*.js"],
    plugins: {
      "aws-durable-execution-eslint": durableFunctionsPlugin,
    },
    rules: {
      "aws-durable-execution-eslint/no-nested-durable-operations": "error",
    },
    languageOptions: {
      parser: typescriptParser,
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
];
