import { createDefaultPreset } from "ts-jest";

const defaultPreset = createDefaultPreset({
  tsconfig: { diagnostics: false, isolatedModules: true },
});

/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  ...defaultPreset,
  testMatch: ["**/__tests__/**/*.test.ts"],
  coverageReporters: ["cobertura", "html", "text"],
};
