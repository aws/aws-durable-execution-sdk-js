/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  displayName: "Scripts Tests",
  roots: ["<rootDir>/src/scripts"],
  testMatch: [
    "**/scripts/**/__tests__/**/*.ts",
    "**/scripts/**/?(*.)+(spec|test).ts",
  ],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  moduleFileExtensions: ["ts", "js", "json", "node"],
  collectCoverage: true,
  coverageDirectory: "coverage/scripts",
  coveragePathIgnorePatterns: ["/node_modules/", "/dist/"],
  coverageReporters: ["text", "lcov", "html"],
  // Only collect coverage from script files, not the main library
  collectCoverageFrom: [
    "src/scripts/**/*.ts",
    "!src/scripts/**/*.test.ts",
    "!src/scripts/**/*.spec.ts",
    "!src/scripts/**/__tests__/**",
  ],
  // Separate cache directory to avoid conflicts
  cacheDirectory: "<rootDir>/node_modules/.cache/jest-scripts",
  // Set environment variables for tests
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
};
