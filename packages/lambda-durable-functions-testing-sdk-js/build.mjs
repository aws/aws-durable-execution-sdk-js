import * as esbuild from "esbuild";

/**
 * @type {esbuild.BuildOptions}
 */
const params = {
  entryPoints: ["./src/index.ts", "./src/checkpoint-server/index.ts"],
  bundle: true,
  packages: "external",
  platform: "node",
  target: "node20",
  outdir: "./dist",
  treeShaking: true,
};

await Promise.all([
  esbuild.build({
    ...params,
    outdir: "dist-cjs",
    format: "cjs",
  }),
  esbuild.build({
    ...params,
    outdir: "dist",
    format: "esm",
  }),
]);
