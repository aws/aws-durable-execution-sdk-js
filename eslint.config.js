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
      "packages/examples/src/examples/**/*.ts",
      "packages/examples/src/examples/**/*.js",
    ],
    plugins: {
      "lambda-durable-functions-eslint-js": durableFunctionsPlugin,
    },
    rules: {
      "lambda-durable-functions-eslint-js/no-nested-durable-operations":
        "error",
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
