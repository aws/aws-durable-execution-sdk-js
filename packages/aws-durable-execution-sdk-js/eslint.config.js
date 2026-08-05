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
      tsdoc: tsdoc,
    },
    rules: {
      ...typescriptEslint.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-console": "warn",
      "no-debugger": "warn",
      "no-duplicate-imports": "error",
      "filename-convention/kebab-case": "error",
      "tsdoc/syntax": "warn",
    },
  },
  {
    files: ["src/**/*.test.ts"],
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
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Jest's manual-mocks directory has a fixed `__mocks__` name —
    // exempt it from the kebab-case rule.
    files: ["src/**/__mocks__/**/*.ts"],
    plugins: {
      "filename-convention": filenameConvention,
    },
    rules: {
      "filename-convention/kebab-case": "off",
    },
  },
  {
    // The wire model is the SDK's own declaration of the durable execution protocol, and
    // nothing portable can depend on the AWS SDK. Keeping it AWS-free is what lets a
    // transport for another compute type be written against these types, so it is enforced
    // rather than left to review. The parity test is exempt: comparing our declarations to
    // the service model is precisely its job, and it imports the AWS types for that.
    files: ["src/types/wire/**/*.ts"],
    ignores: ["src/types/wire/**/*.aws-sdk-parity.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@aws-sdk/*", "aws-lambda"],
              message:
                "The wire model must stay free of AWS types so it can describe the protocol for any compute type. If the service model changed, update the declarations here and let wire-model.aws-sdk-parity.test.ts verify them.",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ["dist/**/*", "node_modules/**/*"],
  },
];
