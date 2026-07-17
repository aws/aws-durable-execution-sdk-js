import { defineConfig } from "rollup";
import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonJs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import { readdirSync, statSync } from "fs";
import { join, resolve } from "path";

// Discover every handler under handlers/<suite>/*.ts and create a flat entry
// point per file. Output name is the bare filename (step_basic.ts ->
// dist/step_basic.js) so it matches the `Handler: step_basic.handler` and
// `CodeUri: ./dist` fields in the SAM templates.
const HANDLERS_ROOT = "handlers";
const entryPoints = {};

for (const suite of readdirSync(HANDLERS_ROOT)) {
  const suiteDir = join(HANDLERS_ROOT, suite);
  if (!statSync(suiteDir).isDirectory()) continue;
  for (const file of readdirSync(suiteDir).filter((f) => f.endsWith(".ts"))) {
    const name = file.replace(/\.ts$/, "");
    entryPoints[name] = join(suiteDir, file);
  }
}

const allEntryPaths = Object.values(entryPoints).map((p) => resolve(p));

export default defineConfig({
  input: entryPoints,
  output: {
    dir: "dist",
    format: "cjs",
    sourcemap: true,
    chunkFileNames: "[name].js",
    manualChunks: (id) => {
      // Bundle all non-handler code (SDK + deps) into a shared vendors chunk.
      if (!allEntryPaths.includes(id)) {
        return "vendors";
      }
      return null;
    },
  },
  plugins: [
    typescript({ tsconfig: "./tsconfig.json" }),
    nodeResolve({ preferBuiltins: true }),
    json(),
    commonJs(),
  ],
});
