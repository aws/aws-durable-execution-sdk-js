// @ts-check

import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import json from "@rollup/plugin-json";
import terser from "@rollup/plugin-terser";

const plugins = [
  nodeResolve({
    preferBuiltins: true,
  }),
  json(),
  terser(),
];

const commonOutputOptions = {
  entryFileNames: "[name].js",
  chunkFileNames: "[name].js",
  assetFileNames: "[name].[ext]",
  sourcemap: true,
  sourcemapExcludeSources: true,
};

/**
 *
 * @param {import('rollup').RollupOptions} options
 * @param {string | undefined} mode
 * @returns {import('rollup').RollupOptions}
 */
export function createBuildOptions(options, mode) {
  if (mode !== "esm" && mode !== "cjs") {
    throw new Error(`Invalid mode ${mode}`);
  }

  const inputPlugins = [
    ...plugins,
    ...(Array.isArray(options.plugins) ? options.plugins : []),
  ];

  if (Array.isArray(options.output)) {
    throw new Error("Output cannot be an array");
  }

  if (mode === "esm") {
    return {
      ...options,
      plugins: [
        typescript({
          noEmitOnError: true,
          declaration: true,
          declarationMap: true,
          outDir: "./dist",
        }),
        ...inputPlugins,
      ],
      output: {
        ...commonOutputOptions,
        ...options.output,
        dir: options.output?.file ? undefined : "dist",
        file: options.output?.file ? `dist/${options.output.file}` : undefined,
        format: "esm",
      },
    };
  }

  return {
    ...options,
    plugins: [
      typescript({
        noEmitOnError: true,
        declaration: false,
        declarationMap: false,
        emitDeclarationOnly: false,
        outDir: undefined,
      }),
      ...inputPlugins,
    ],
    output: {
      ...commonOutputOptions,
      ...options.output,
      dir: options.output?.file ? undefined : "dist-cjs",
      file: options.output?.file
        ? `dist-cjs/${options.output.file}`
        : undefined,
      format: "cjs",
    },
  };
}
