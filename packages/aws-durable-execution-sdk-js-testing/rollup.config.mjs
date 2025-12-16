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

export default createBuildOptions(config, process.env.MODE, packageJson);
