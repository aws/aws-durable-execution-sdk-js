import { createRequire } from "module";
const require = createRequire(import.meta.url);

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
    files: [
      "src/examples/**/*.ts",
      "src/examples/**/*.js",
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
