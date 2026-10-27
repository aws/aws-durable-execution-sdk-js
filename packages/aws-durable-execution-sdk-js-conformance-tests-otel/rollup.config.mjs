import commonJs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "rollup";

const handlersRoot = "handlers";
const entryPoints = Object.fromEntries(
  readdirSync(handlersRoot)
    .filter((file) => /^otel_\d+.*\.ts$/.test(file))
    .map((file) => [file.replace(/\.ts$/, ""), `${handlersRoot}/${file}`]),
);
const handlerPaths = Object.values(entryPoints).map((path) => resolve(path));

export default defineConfig({
  input: entryPoints,
  output: {
    dir: "dist",
    format: "cjs",
    sourcemap: true,
    sourcemapExcludeSources: true,
    chunkFileNames: "[name].js",
    manualChunks: (id) => (handlerPaths.includes(id) ? null : "vendors"),
  },
  plugins: [
    typescript({ tsconfig: "./tsconfig.json" }),
    nodeResolve({ preferBuiltins: true }),
    json(),
    commonJs(),
  ],
  onwarn(warning, warn) {
    if (
      warning.code === "CIRCULAR_DEPENDENCY" &&
      warning.message.includes("node_modules")
    ) {
      return;
    }
    warn(warning);
  },
});
