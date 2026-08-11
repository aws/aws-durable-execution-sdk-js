// @ts-check

import nodeExternals from "rollup-plugin-node-externals";
import { createBuildOptions } from "../../rollup.config.js";
import packageJson from "./package.json" with { type: "json" };

const config = {
  input: /** @type {Record<string, string>} */ ({
    index: "./src/index.ts",
    "otel-execution": "./src/execution-plugin-provider.ts",
    "otel-invocation": "./src/invocation-plugin-provider.ts",
  }),
  plugins: [nodeExternals()],
};

export default createBuildOptions(config, process.env.MODE, packageJson);
