import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.ts", "src/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "src/scripts/**"],
    setupFiles: ["./vitest.setup.ts"],
    // `npm test` runs with --coverage, so CI checks the thresholds below.
    // Coverage adds about 1s to a local run. Use `npx vitest run` for a run
    // without coverage.
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/library",
      include: ["src/**/*.ts"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "src/**/*.test-d.ts",
        "src/**/__tests__/**",
        "src/scripts/**",
        "src/demo/**",
        "src/testing/**",
        "src/index.ts", // barrel export file
      ],
      // A floor about 1 point below the measured coverage, so a change that
      // drops coverage fails `npm run test:coverage`. Raise these when
      // coverage goes up.
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 93,
        lines: 95,
      },
    },
  },
});
