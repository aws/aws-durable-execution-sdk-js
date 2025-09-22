// @ts-check

import nodeExternals from "rollup-plugin-node-externals";
import { createBuildOptions } from "../../rollup.config.js";

const config = {
  input: {
    index: "./src/index.ts",
    "checkpoint-server/index": "./src/checkpoint-server/index.ts",
  },
  plugins: [nodeExternals()],
};

export default createBuildOptions(config, process.env.MODE);
