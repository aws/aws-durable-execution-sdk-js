// @ts-check

import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";

const plugins = [json()];

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

  const commonConfig = {
    ...options,
    onwarn: (warning, warn) => {
      // Suppress warnings for known external dependencies
      if (
        warning.code === "UNRESOLVED_IMPORT" &&
        (warning.exporter?.startsWith("@aws-sdk/") ||
          warning.exporter?.startsWith("@smithy/") ||
          warning.exporter?.startsWith("@aws-crypto/") ||
          ["crypto", "events"].includes(warning.exporter))
      ) {
        return;
      }
      warn(warning);
    },
  };

  if (mode === "esm") {
    return {
      ...commonConfig,
      plugins: [
        typescript({
          noEmitOnError: true,
          declaration: false,
          declarationMap: false,
          outDir: "./dist",
          exclude: ["**/__tests__/**/*"],
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
    ...commonConfig,
    plugins: [
      typescript({
        noEmitOnError: true,
        declaration: false,
        declarationMap: false,
        emitDeclarationOnly: false,
        outDir: undefined,
        exclude: ["**/__tests__/**/*"],
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
