import { createDefaultPreset } from "ts-jest";

// The handler is deploy-only. The deployed conformance run validates the exported record.
// What is testable here is the wiring: template -> handler module/export, requirement
// coverage, and the `TelemetryLogGroupName` parameter contract with the runner. These tests
// read the handler as text, so they cannot detect a handler that no longer compiles against
// the SDK. The package's `test` script therefore runs `typecheck` first. No CI workflow
// deploys this package yet (a caller workflow is a follow-on), so `tsc --noEmit` is the only
// required check that compiles the handler.
//
// tsconfig.json targets the bundler (module: ESNext, moduleResolution: bundler) because
// rollup consumes it. Jest runs CommonJS, so override just those options for the tests.
const preset = createDefaultPreset({
  tsconfig: {
    diagnostics: false,
    isolatedModules: true,
    module: "commonjs",
    moduleResolution: "bundler",
    // tsconfig.json sets rootDir to ./handlers for rollup. These tests live in
    // __tests__/, outside that root, so widen it here -- otherwise ts-jest cannot
    // place its output and refuses to transform them.
    rootDir: ".",
  },
});

/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  ...preset,
  testMatch: ["**/__tests__/**/*.test.ts"],
};
