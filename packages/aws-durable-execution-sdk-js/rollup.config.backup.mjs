// @ts-check

import { createBuildOptions } from "../../rollup.config.js";
import packageJson from "./package.json" with { type: "json" };

// Custom ESM shim that's safer when bundled to CJS
function saferEsmShim() {
  return {
    name: "safer-esm-shim",
    generateBundle(options, bundle) {
      for (const fileName in bundle) {
        const chunk = bundle[fileName];
        if (chunk.type === "chunk" && chunk.code) {
          // Replace the problematic ESM shim with a safer version
          chunk.code = chunk.code
            .replace(
              /const __filename = cjsUrl\.fileURLToPath\(import\.meta\.url\);/g,
              'const __filename = (typeof import.meta !== "undefined" && import.meta.url) ? cjsUrl.fileURLToPath(import.meta.url) : "";',
            )
            .replace(
              /const __dirname = cjsPath\.dirname\(__filename\);/g,
              'const __dirname = __filename ? cjsPath.dirname(__filename) : "";',
            )
            .replace(
              /const require = cjsModule\.createRequire\(import\.meta\.url\);/g,
              'const require = (typeof import.meta !== "undefined" && import.meta.url) ? cjsModule.createRequire(import.meta.url) : (() => { throw new Error("require is not available"); });',
            );
        }
      }
    },
  };
}

const config = {
  input: "./src/index.ts",
  output: {
    file: "index",
    inlineDynamicImports: true,
  },
  plugins: [saferEsmShim()],
};

export default createBuildOptions(config, process.env.MODE, packageJson);
