const { createDefaultPreset } = require("ts-jest");

const defaultPreset = createDefaultPreset();

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  ...defaultPreset,
  testMatch: ["**/src/examples/**/*.test.ts"],
  testTimeout: 90000,
  // Setup file to configure retries for flaky integration tests
  setupFilesAfterEnv: ["<rootDir>/jest.setup.integration.js"],
};
