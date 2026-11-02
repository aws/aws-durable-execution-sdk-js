import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // `vscode` only exists inside the extension host. Tests that need
      // behaviour override it with vi.mock("vscode", factory).
      vscode: fileURLToPath(new URL("./src/test/vscodeStub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["webview-ui/**", "node_modules/**"],
  },
});
