import { createRequire } from "module";
const require = createRequire(import.meta.url);

const durableFunctionsPlugin = require("./packages/aws-durable-execution-sdk-js-eslint-plugin/dist/index.js");
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
    files: [
      "packages/aws-durable-execution-sdk-js-examples/src/examples/**/*.ts",
      "packages/aws-durable-execution-sdk-js-examples/src/examples/**/*.js",
      "test-eslint.ts",
    ],
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
