// @ts-check

import { defineConfig } from "rollup";
import examplesCatalog from "./examples-catalog.json" with { type: "json" };
import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import json from "@rollup/plugin-json";
import commonJs from "@rollup/plugin-commonjs";

const config = defineConfig(
  examplesCatalog.examples.map((example) =>
    defineConfig({
      input: example.path,
      output: {
        file: `dist/${example.handler.replace(".handler", ".js")}`,
        format: "cjs",
        inlineDynamicImports: true,
        sourcemap: true,
        sourcemapExcludeSources: true,
      },
      plugins: [
        typescript(),
        nodeResolve({
          preferBuiltins: true,
        }),
        json(),
        commonJs(),
      ],
    })
  )
);

export default config;
