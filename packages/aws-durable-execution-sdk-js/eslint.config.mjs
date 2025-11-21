// @ts-check

import filenameConvention from "eslint-plugin-filename-convention";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import tsdoc from "eslint-plugin-tsdoc";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import js from "@eslint/js";
import { fileURLToPath } from "node:url";
import { includeIgnoreFile } from "@eslint/compat";

const gitIgnorePath = fileURLToPath(new URL(".gitignore", import.meta.url));

export default defineConfig([
  includeIgnoreFile(gitIgnorePath, "Imported .gitignore patterns"),
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    plugins: { js },
    extends: ["js/recommended"],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: { globals: globals.node },
  },
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "filename-convention": filenameConvention,
      tsdoc: tsdoc,
    },
    rules: {
      // Rules that are temporarily set to warning, but should be switched to errors
      "@typescript-eslint/restrict-template-expressions": [
        "warn",
        {
          allowNumber: true,
          allowBoolean: true,
        },
      ],
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "no-empty": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/prefer-nullish-coalescing": "warn",
      "no-async-promise-executor": "warn",
      "@typescript-eslint/no-empty-function": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/only-throw-error": "warn",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",

      // Modified rules
      "@typescript-eslint/no-confusing-void-expression": [
        "error",
        {
          ignoreArrowShorthand: true,
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Additional custom rules
      "no-console": "error",
      "no-debugger": "error",
      "no-duplicate-imports": "error",
      "filename-convention/kebab-case": "error",
      "tsdoc/syntax": "warn",

      // Disabled rules

      // Async functions without await allow throwing async promises still
      "@typescript-eslint/require-await": "off",
      // Validation of parameters will create "unnecessary" conditions
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/restrict-plus-operands": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/only-throw-error": "off",
    },
  },
  eslintConfigPrettier,
]);
