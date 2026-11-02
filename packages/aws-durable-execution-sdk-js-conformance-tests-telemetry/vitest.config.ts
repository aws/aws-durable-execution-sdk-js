import { defineConfig } from "vitest/config";

// The handler is deploy-only. The deployed conformance run validates the exported record.
// What is testable here is the wiring: template -> handler module/export, requirement
// coverage, and the `TelemetryLogGroupName` parameter contract with the runner. These tests
// read the handler as text, so they cannot detect a handler that no longer compiles against
// the SDK. The package's `test` script therefore runs `typecheck` first. No CI workflow
// deploys this package yet (a caller workflow is a follow-on), so `tsc --noEmit` is the only
// required check that compiles the handler.
export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
  },
});
