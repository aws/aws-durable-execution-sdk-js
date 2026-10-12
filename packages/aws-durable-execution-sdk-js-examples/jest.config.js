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
  // These tests run examples in the local runner. On the 4-CPU CI runner the
  // suite took about 57 s with Jest's default of CPUs - 1 workers, 29 s with
  // 8 workers, and 23 s with 12. So the suite is not CPU-bound, and a fixed
  // count above the CPU count finishes sooner.
  maxWorkers: 12,
};
