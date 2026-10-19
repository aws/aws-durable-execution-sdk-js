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

// The `./powertools` subpath export. It is a separate build so the main bundle
// keeps its single-file output. It imports only types from the SDK, so the
// SDK code is not duplicated into it.
const powertoolsConfig = {
  input: "./src/powertools/index.ts",
  output: {
    file: "powertools",
  },
};

export default [
  createBuildOptions(config, process.env.MODE, packageJson),
  createBuildOptions(powertoolsConfig, process.env.MODE, packageJson),
];
