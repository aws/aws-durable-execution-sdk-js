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
  // These tests run examples in the local runner, and many tests wait on
  // timers instead of using the CPU. Jest's default of CPUs - 1 workers
  // leaves the CPU idle during those waits. So a fixed count above the CPU
  // count finishes sooner.
  maxWorkers: 12,
};
