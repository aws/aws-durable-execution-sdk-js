module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: {
    "^.+\\.ts$": ["ts-jest", { diagnostics: false, isolatedModules: true }],
  },
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.test.ts"],
};
