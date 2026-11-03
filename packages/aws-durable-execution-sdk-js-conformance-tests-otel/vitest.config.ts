import { defineConfig } from "vitest/config";

// The handlers themselves are deploy-only and their telemetry is validated by the deployed
// conformance run. What is testable here -- and worth testing, because CI silently deploys
// whatever the templates point at -- is the wiring: template -> handler module/export,
// requirement coverage, and the workflow input that aims the shared orchestrator at this
// package. These tests read the handlers as text, so the package's `test` script runs
// `typecheck` first: the deployed run is skipped for fork pull requests and needs
// credentials, so `tsc --noEmit` is what keeps required CI from passing on handlers that no
// longer compile against the SDK.
export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
  },
});
