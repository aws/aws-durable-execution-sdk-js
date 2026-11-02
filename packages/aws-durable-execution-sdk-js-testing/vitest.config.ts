import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,js}"],
      exclude: ["src/test-runner/local/__tests__/integration"],
      reporter: ["cobertura", "html", "text"],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 90,
        statements: 90,
      },
    },
  },
});
