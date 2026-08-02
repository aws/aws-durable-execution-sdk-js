/**
 * Tests for pure logic (studioModel model/parse/validation/layout/scope, plus
 * standalone helpers like relativeTime / nextExecutionName). React/DOM UI is
 * intentionally out of scope. Uses the repo's hoisted ts-jest; run with
 * `../../../node_modules/.bin/jest -c jest.config.js`.
 */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          target: "ES2020",
          esModuleInterop: true,
          jsx: "react-jsx",
          skipLibCheck: true,
        },
      },
    ],
  },
};
