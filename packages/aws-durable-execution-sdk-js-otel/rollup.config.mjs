// @ts-check

import { createBuildOptions } from "../../rollup.config.js";
import packageJson from "./package.json" with { type: "json" };

// Mark all dependencies and peer dependencies as external to avoid bundling them
const external = [
  ...Object.keys(packageJson.dependencies || {}),
  ...Object.keys(packageJson.peerDependencies || {}),
];

const config = {
  input: "./src/index.ts",
  external: (id) =>
    external.some((dep) => id === dep || id.startsWith(dep + "/")),
  output: {
    file: "index",
    inlineDynamicImports: true,
  },
};

export default createBuildOptions(config, process.env.MODE, packageJson);
