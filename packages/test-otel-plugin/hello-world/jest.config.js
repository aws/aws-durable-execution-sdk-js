"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/unit/*.test.ts"],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
};
