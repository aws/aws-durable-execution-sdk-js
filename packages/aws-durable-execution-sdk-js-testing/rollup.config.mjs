// @ts-check

import nodeExternals from "rollup-plugin-node-externals";
import { createBuildOptions } from "../../rollup.config.js";
import packageJson from "./package.json" with { type: "json" };

const config = {
  input: /** @type {Record<string, string>} */ ({
    index: "./src/index.ts",
    "checkpoint-server/index": "./src/checkpoint-server/index.ts",
  }),
  plugins: [nodeExternals()],
};

if (process.env.MODE === "esm") {
  config.input["cli/run-durable"] = "./src/cli/run-durable/index.ts";
}

// `esmShim: true` synthesises top-level `__filename` / `__dirname`
// in the ESM dist via `@rollup/plugin-esm-shim`. This package's
// `checkpoint-worker-manager.ts` references bare `__dirname`, and
// the ESM dist is consumed directly by Node (the `run-durable` CLI
// binary — never re-bundled by esbuild), so the banner is safe here.
// The SDK package opts out because consumers DO re-bundle its .mjs
// into CJS, which would crash on the banner's `import.meta.url`
// reference.
export default createBuildOptions(config, process.env.MODE, packageJson, {
  esmShim: true,
});
