/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  displayName: "Library Tests",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
  // Exclude scripts tests from main library tests
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/src/scripts/"],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  moduleFileExtensions: ["ts", "js", "json", "node"],
  collectCoverage: true,
  coverageDirectory: "coverage/library",
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/src/scripts/",
    "/src/demo/",
    "/src/testing/",
  ],
  // Only collect coverage from library code, not scripts or demo files
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.test.ts",
    "!src/**/*.spec.ts",
    "!src/**/__tests__/**",
    "!src/scripts/**", // Exclude all scripts from library coverage
    "!src/demo/**", // Exclude all demo files from library coverage
    "!src/testing/**", // Exclude all testing utilities from library coverage
    "!src/index.ts", // Exclude barrel export file from coverage
    "!src/run-durable.ts", // Exclude temporary file from coverage
  ],
  // Set environment variables for tests
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
};
