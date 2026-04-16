/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  displayName: "OTel Plugin Tests",
  roots: ["<rootDir>/src"],
  testMatch: ["**/?(*.)+(spec|test).ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        diagnostics: false,
      },
    ],
  },
  moduleNameMapper: {
    "^@aws/durable-execution-sdk-js$":
      "<rootDir>/../aws-durable-execution-sdk-js/src/index.ts",
  },
  moduleFileExtensions: ["ts", "js", "json", "node"],
  collectCoverage: true,
  coverageDirectory: "coverage",
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.test.ts", "!src/index.ts"],
};
