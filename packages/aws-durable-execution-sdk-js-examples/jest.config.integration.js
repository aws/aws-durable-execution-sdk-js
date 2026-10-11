const { createDefaultPreset } = require("ts-jest");

const defaultPreset = createDefaultPreset({
  tsconfig: { diagnostics: false, isolatedModules: true },
});

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  ...defaultPreset,
  testMatch: ["**/src/examples/**/*.test.ts"],
  testTimeout: 120000,
  testNamePattern: "cloud",
  bail: true,
  // Each integration test spends most of its time waiting on Lambda, not on
  // the CPU. Jest's default worker count is CPUs - 1, which assumes CPU-bound
  // tests. So the default leaves the runner mostly idle. A fixed count runs
  // more test files against Lambda at the same time.
  maxWorkers: 16,
};
