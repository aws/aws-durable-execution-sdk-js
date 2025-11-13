const { createDefaultPreset } = require("ts-jest");

const defaultPreset = createDefaultPreset();

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  ...defaultPreset,
  testMatch: ["**/__tests__/**.test.ts", "**/src/examples/**/*.test.ts"],
  coverageReporters: ["cobertura", "html", "text"],
  coverageDirectory: "coverage-sdk",
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/dur-sdk/run-durable.ts",
    "!**/*.test.ts",
    "!**/*.d.ts",
  ],
  moduleNameMapper: {
    "^@aws/durable-execution-sdk-js$": "<rootDir>/src/dur-sdk/index.ts",
  },
};
