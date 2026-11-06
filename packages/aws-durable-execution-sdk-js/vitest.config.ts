import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.ts", "src/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "src/scripts/**"],
    setupFiles: ["./vitest.setup.ts"],
    // Off by default: coverage instrumentation adds real wall time to every
    // local `npm test`. Use `npm run test:coverage` when coverage is wanted.
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/library",
      include: ["src/**/*.ts"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "src/**/__tests__/**",
        "src/scripts/**",
        "src/demo/**",
        "src/testing/**",
        "src/index.ts", // barrel export file
      ],
    },
  },
});
