import { createDefaultPreset } from "ts-jest";

const defaultPreset = createDefaultPreset({
  tsconfig: { diagnostics: false, isolatedModules: true },
});

/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  ...defaultPreset,
  globalSetup: "<rootDir>/test-setup/build-workspace-candidates.mjs",
  testMatch: ["**/__tests__/**/*.test.ts"],
  setupFiles: ["<rootDir>/jest.setup.mjs"],
  coverageReporters: ["cobertura", "html", "text"],
};
