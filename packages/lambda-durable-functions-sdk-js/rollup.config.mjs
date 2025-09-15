// @ts-check

import { createBuildOptions } from "../../rollup.config.js";

const config = {
  input: "./src/index.ts",
  output: {
    file: "index.js",
    inlineDynamicImports: true,
  },
};

export default createBuildOptions(config, process.env.MODE);
