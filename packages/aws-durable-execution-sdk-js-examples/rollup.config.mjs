// @ts-check

import { defineConfig } from "rollup";
import examplesCatalog from "./examples-catalog.json" with { type: "json" };
import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import json from "@rollup/plugin-json";
import commonJs from "@rollup/plugin-commonjs";
import path from "path";

const allExamplePaths = examplesCatalog.examples.map((example) =>
  path.resolve(example.path),
);

const inputs = Object.fromEntries(
  examplesCatalog.examples.map((example) => [
    example.handler.slice(0, example.handler.lastIndexOf(".")),
    example.path,
  ]),
);

export default defineConfig({
  input: inputs,
  output: {
    dir: "dist",
    format: "cjs",
    sourcemap: true,
    sourcemapExcludeSources: true,
    chunkFileNames: "[name].js",
    manualChunks: (id) => {
      // Bundle all non-examples in one dependency file
      if (!allExamplePaths.includes(id)) {
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
