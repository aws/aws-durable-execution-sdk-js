const { createDefaultPreset } = require("ts-jest");

const defaultPreset = createDefaultPreset();

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  ...defaultPreset,
  testMatch: ["**/src/examples/**/*.test.ts"],
  testTimeout: 120000,
  testNamePattern: "cloud",
  bail: true,
};
