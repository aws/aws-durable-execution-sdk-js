import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    globalSetup: ["test-setup/build-workspace-candidates.mjs"],
    setupFiles: ["vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,js}"],
      reporter: ["cobertura", "html", "text"],
    },
  },
});
