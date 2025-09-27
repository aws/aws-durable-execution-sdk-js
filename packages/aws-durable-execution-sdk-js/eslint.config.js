const tsParser = require("@typescript-eslint/parser");
const typescriptEslint = require("@typescript-eslint/eslint-plugin");
const filenameConvention = require("eslint-plugin-filename-convention");
const tsdoc = require("eslint-plugin-tsdoc");

module.exports = [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      "@typescript-eslint": typescriptEslint,
      "filename-convention": filenameConvention,
      "tsdoc": tsdoc,
    },
    rules: {
      ...typescriptEslint.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "no-console": "warn",
      "no-debugger": "warn",
      "no-duplicate-imports": "error",
      "filename-convention/kebab-case": "error",
      "tsdoc/syntax": "warn",
    },
  },
  {
    ignores: ["dist/**/*", "node_modules/**/*"],
  },
];
