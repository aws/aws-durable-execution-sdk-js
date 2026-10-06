const { createDefaultPreset } = require("ts-jest");

const defaultPreset = createDefaultPreset({
  tsconfig: { diagnostics: false, isolatedModules: true },
});

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  ...defaultPreset,
  testMatch: ["**/__tests__/**.test.ts", "**/src/examples/**/*.test.ts"],
  setupFiles: ["<rootDir>/jest.setup.js"],
  coverageReporters: ["cobertura", "html", "text"],
};
