// @ts-check

import { createBuildOptions } from "../../rollup.config.js";
import packageJson from "./package.json" with { type: "json" };

const config = {
  input: "./src/index.ts",
  output: {
    file: "index",
    inlineDynamicImports: true,
  },
};

export default createBuildOptions(config, process.env.MODE, packageJson);
