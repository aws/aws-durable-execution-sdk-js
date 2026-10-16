/**
 * Type-level checks of the plugin's public types against ESLint's own types.
 *
 * This file is not a Jest test and is never run. `npm run typecheck` compiles
 * it with tsc, and the compile fails if the plugin stops type-checking in the
 * ways a TypeScript `eslint.config.ts` uses it. Jest cannot catch these
 * errors, because ts-jest runs with type diagnostics off (jest.config.js).
 *
 * The types come from the ESLint version the repository installs (10). Each
 * assignment below is one setup from the README.
 */
import type { ESLint, Linter } from "eslint";
import { defineConfig } from "eslint/config";
import plugin from "./index";

// The recommended flat config, used as a config object.
export const recommended: Linter.Config = plugin.configs["flat/recommended"];

// The README "files"-limited spread.
export const filesLimited: Linter.Config = {
  ...plugin.configs["flat/recommended"],
  files: ["src/handlers/**/*.ts"],
};

// The README "Choose the rules yourself" setup.
export const byHand: Linter.Config = {
  files: ["**/*.ts"],
  plugins: { durable: plugin },
  rules: { "durable/no-nested-durable-operations": "error" },
};

// The plugin object itself.
export const asPlugin: ESLint.Plugin = plugin;

// defineConfig(), the helper most TypeScript eslint.config.ts files use.
export const viaDefineConfig = defineConfig([
  plugin.configs["flat/recommended"],
  { files: ["**/*.ts"], plugins: { durable: plugin } },
]);
