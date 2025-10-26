import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import the plugin directly
const durableFunctionsPlugin = {
  rules: {
    "no-nested-durable-operations": (
      await import(
        "../aws-durable-execution-sdk-js-eslint-plugin/dist/rules/no-nested-durable-operations.js"
      )
    ).noNestedDurableOperations,
    "no-non-deterministic-outside-step": (
      await import(
        "../aws-durable-execution-sdk-js-eslint-plugin/dist/rules/no-non-deterministic-outside-step.js"
      )
    ).noNonDeterministicOutsideStep,
  },
};

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      "durable-functions": durableFunctionsPlugin,
    },
    rules: {
      "durable-functions/no-nested-durable-operations": "error",
      "durable-functions/no-non-deterministic-outside-step": "error",
    },
  },
];
