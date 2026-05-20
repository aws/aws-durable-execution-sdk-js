// @ts-check

import { createBuildOptions } from "../../rollup.config.js";
import packageJson from "./package.json" with { type: "json" };

// Custom ESM shim that handles our __dirname usage safely
function saferEsmShim() {
  return {
    name: "safer-esm-shim",
    generateBundle(options, bundle) {
      for (const fileName in bundle) {
        const chunk = bundle[fileName];
        if (chunk.type === "chunk" && chunk.code) {
          // Only add shim if __dirname is actually used in the code
          if (chunk.code.includes("typeof __dirname")) {
            // Add safe shim at the top
            const shimCode = `
// Safe __dirname shim for bundled environments
if (typeof __dirname === 'undefined') {
  var __dirname = '';
}
`;
            chunk.code = shimCode + chunk.code;
          }
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

// Create build options and remove default ESM shim, use our custom one
const buildOptions = createBuildOptions(config, process.env.MODE, packageJson);

// Remove the default esmShim plugin since we have our own
if (process.env.MODE === "esm" && Array.isArray(buildOptions.plugins)) {
  buildOptions.plugins = buildOptions.plugins.filter(
    (plugin) => !plugin || plugin.name !== "esm-shim",
  );
}

export default buildOptions;
