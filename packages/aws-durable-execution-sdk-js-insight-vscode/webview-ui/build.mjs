import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/index.tsx"],
  bundle: true,
  outfile: "../media/webview.js",
  platform: "browser",
  format: "iife",
  target: "es2020",
  jsx: "automatic",
  sourcemap: false,
  minify: !watch,
  logLevel: "info",
  // Monaco imports .css (collected into media/webview.css) and the codicon
  // .ttf font (inlined as a data URL so it needs no extra webview resource).
  loader: { ".css": "css", ".ttf": "dataurl" },
};

// Monaco's language services run in web workers. Bundle the two we need
// (the generic editor worker + the TypeScript worker) as standalone classic
// worker scripts under media/monaco/, loaded at runtime via importScripts.
/** @type {import("esbuild").BuildOptions} */
const workerOptions = {
  entryPoints: {
    "editor.worker":
      "node_modules/monaco-editor/esm/vs/editor/editor.worker.js",
    "ts.worker":
      "node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js",
  },
  bundle: true,
  outdir: "../media/monaco",
  entryNames: "[name]",
  platform: "browser",
  format: "iife",
  target: "es2020",
  sourcemap: false,
  minify: !watch,
  logLevel: "info",
  loader: { ".ttf": "dataurl" },
};

if (watch) {
  const [appCtx, workerCtx] = await Promise.all([
    esbuild.context(options),
    esbuild.context(workerOptions),
  ]);
  await Promise.all([appCtx.watch(), workerCtx.watch()]);
} else {
  await Promise.all([esbuild.build(options), esbuild.build(workerOptions)]);
}
