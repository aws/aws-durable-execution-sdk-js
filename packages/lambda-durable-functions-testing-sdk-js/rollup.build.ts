import { InputOptions, OutputOptions, rollup } from "rollup";
import typescript, { RollupTypescriptOptions } from "@rollup/plugin-typescript";
import nodeExternals from "rollup-plugin-node-externals";

const commonInputOptions = {
  input: {
    index: "./src/index.ts",
    "checkpoint-server/index": "./src/checkpoint-server/index.ts",
  },
  plugins: [nodeExternals()],
  external: ["@amzn/dex-internal-sdk"],
} satisfies InputOptions;

const commonTypeScriptOptions = {
  declaration: false,
  declarationMap: false,
  outDir: undefined,
} satisfies RollupTypescriptOptions;

const commonOutputOptions = {
  entryFileNames: "[name].js",
  chunkFileNames: "[name].js",
  assetFileNames: "[name].[ext]",
  sourcemap: true,
} satisfies OutputOptions;

const optionsList = [
  {
    input: {
      ...commonInputOptions,
      plugins: [
        ...commonInputOptions.plugins,
        typescript({
          ...commonTypeScriptOptions,
          outDir: "./dist",
        }),
      ],
    },
    output: {
      ...commonOutputOptions,
      dir: "dist",
      format: "esm",
    },
  },
  {
    input: {
      ...commonInputOptions,
      plugins: [
        ...commonInputOptions.plugins,
        typescript({
          ...commonTypeScriptOptions,
          outDir: "./dist-cjs",
        }),
      ],
    },
    output: {
      ...commonOutputOptions,
      dir: "dist-cjs",
      format: "cjs",
    },
  },
] satisfies {
  input: InputOptions;
  output: OutputOptions;
}[];

async function build() {
  await Promise.all(
    optionsList.map(async ({ input, output }) => {
      await using bundle = await rollup(input);
      await bundle.write(output);
    })
  );
}

build().catch((err: unknown) => {
  process.exitCode = 1;
  console.error(err);
});
