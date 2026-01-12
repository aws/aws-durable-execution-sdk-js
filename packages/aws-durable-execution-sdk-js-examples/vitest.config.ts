import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/esm-examples/**/*.test.ts"],
  },
});
