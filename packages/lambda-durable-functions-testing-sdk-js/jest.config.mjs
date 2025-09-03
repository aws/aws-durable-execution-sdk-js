import { createDefaultPreset } from "ts-jest";

const defaultPreset = createDefaultPreset();

/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  ...defaultPreset,
  testMatch: ["**/__tests__/**/*.test.ts"],
  coverageReporters: ["cobertura", "html", "text"],
  coveragePathIgnorePatterns: [
    "<rootDir>/src/test-runner/local/__tests__/integration",
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 90,
      statements: 90,
    },
  },
};
