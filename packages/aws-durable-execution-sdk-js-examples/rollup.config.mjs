// @ts-check

import { defineConfig } from "rollup";
import examplesCatalog from "./src/utils/examples-catalog.json" with {
  type: "json",
};
import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import json from "@rollup/plugin-json";
import commonJs from "@rollup/plugin-commonjs";
import path from "path";
import { fileURLToPath } from "url";

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
    {
      // src/utils/examples-catalog.d.json.ts types the generated catalog for `tsc`.
      // @rollup/plugin-typescript resolves imports with TypeScript's resolver, which prefers
      // that declaration to the JSON and would hand Rollup a .ts file to parse as JSON, so
      // the import is resolved to the real file here, ahead of it.
      name: "resolve-examples-catalog-json",
      resolveId(source, importer) {
        if (
          source === "./examples-catalog.json" &&
          importer?.endsWith(path.join("utils", "examples-catalog.ts"))
        ) {
          return path.resolve(path.dirname(importer), "examples-catalog.json");
        }
        return null;
      },
    },
    typescript({
      // Disable incremental build to ensure examples catalog is parsed
      incremental: false,
      tsconfig: path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "./tsconfig.build.json",
      ),
    }),
    nodeResolve({
      preferBuiltins: true,
    }),
    json(),
    commonJs(),
  ],
  onwarn(warning, warn) {
    // Suppress circular dependency warnings from external dependencies (node_modules)
    // but keep them for our own code to catch potential issues
    if (
      warning.code === "CIRCULAR_DEPENDENCY" &&
      warning.message.includes("node_modules")
    ) {
      return;
    }
    warn(warning);
  },
});
