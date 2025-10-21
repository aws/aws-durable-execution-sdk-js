// @ts-check

import { defineConfig } from "rollup";
import examplesCatalog from "./src/utils/examples-catalog.json" with { type: "json" };
import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import json from "@rollup/plugin-json";
import commonJs from "@rollup/plugin-commonjs";
import path from "path";

const allExamplePaths = examplesCatalog.map((example) =>
  path.resolve(example.path),
);

const exampleInputs = Object.fromEntries(
  examplesCatalog.map((example) => [
    example.handler.slice(0, example.handler.lastIndexOf(".")),
    example.path,
  ]),
);

export default defineConfig({
  input: {
    ...exampleInputs,
    "examples-catalog": "./src/utils/examples-catalog.ts",
  },
  output: {
    dir: "dist",
    format: "cjs",
    sourcemap: true,
    sourcemapExcludeSources: true,
    chunkFileNames: "[name].js",
    manualChunks: (id) => {
      // Bundle all non-examples in one dependency file
      if (!allExamplePaths.includes(id) && !id.includes("examples-catalog")) {
        return "vendors";
      }

      return null;
    },
  },
  plugins: [
    typescript(),
    nodeResolve({
      preferBuiltins: true,
    }),
    json(),
    commonJs(),
  ],
});
