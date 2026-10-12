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
  // tests. On the 4-CPU CI runner that ran 3 files at a time, and the suite
  // took about 276 s. With 16 workers it took about 58 s.
  // With 24 workers the Lambda API returned TooManyRequestsException, and
  // bail stopped the run. So do not raise this without checking throttling.
  // Other AWS accounts can have lower quotas than the CI account. So the
  // override applies only in CI, and local runs keep Jest's default.
  ...(process.env.CI ? { maxWorkers: 16 } : {}),
};
