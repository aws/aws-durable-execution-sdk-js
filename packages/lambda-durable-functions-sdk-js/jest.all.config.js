/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  projects: [
    {
      displayName: "Library Tests",
      preset: "ts-jest",
      testEnvironment: "node",
      roots: ["<rootDir>/src"],
      testMatch: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
      testPathIgnorePatterns: ["/node_modules/", "/dist/", "/src/scripts/"],
      transform: {
        "^.+\\.ts$": "ts-jest",
      },
      moduleFileExtensions: ["ts", "js", "json", "node"],
      coverageDirectory: "coverage/library",
      coveragePathIgnorePatterns: [
        "/node_modules/",
        "/dist/",
        "/src/scripts/",
        "/src/demo/",
      ],
      collectCoverageFrom: [
        "src/**/*.ts",
        "!src/**/*.test.ts",
        "!src/**/*.spec.ts",
        "!src/**/__tests__/**",
        "!src/scripts/**",
        "!src/demo/**", // Exclude demo files from library coverage
        "!src/index.ts", // Exclude barrel export file from coverage
      ],
      setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
    },
    {
      displayName: "Scripts Tests",
      preset: "ts-jest",
      testEnvironment: "node",
      roots: ["<rootDir>/src/scripts"],
      testMatch: [
        "**/scripts/**/__tests__/**/*.ts",
        "**/scripts/**/?(*.)+(spec|test).ts",
      ],
      transform: {
        "^.+\\.ts$": "ts-jest",
      },
      moduleFileExtensions: ["ts", "js", "json", "node"],
      coverageDirectory: "coverage/scripts",
      coveragePathIgnorePatterns: ["/node_modules/", "/dist/"],
      collectCoverageFrom: [
        "src/scripts/**/*.ts",
        "!src/scripts/**/*.test.ts",
        "!src/scripts/**/*.spec.ts",
        "!src/scripts/**/__tests__/**",
      ],
      setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
    },
  ],
  // Combined coverage settings
  coverageDirectory: "coverage/combined",
  coverageReporters: ["text", "lcov", "html"],
};
