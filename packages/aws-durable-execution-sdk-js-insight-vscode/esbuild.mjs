import esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const watch = process.argv.includes("--watch");

// `source-map`@0.7 (used by remoteDebug/mapBridge.ts, bundled above) parses
// mappings in wasm and loads `lib/mappings.wasm` at runtime via
// `path.join(__dirname, "mappings.wasm")` — in the flattened CJS bundle
// __dirname is dist/, so the sidecar must sit next to extension.js or the
// first debug run dies with ENOENT (the build itself succeeds either way).
// Resolved from THIS package so the wasm matches the exact 0.7.x whose JS
// gets bundled (the workspace root hoists an incompatible 0.6.x).
const require = createRequire(import.meta.url);
mkdirSync("dist", { recursive: true });
copyFileSync(
  require.resolve("source-map/lib/mappings.wasm"),
  "dist/mappings.wasm",
);

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  target: "node20",
  // 'vscode' is provided by the extension host at runtime and must not be
  // bundled. 'esbuild' is required at runtime (it bundles generated workflow
  // handlers before deploy) and ships its own native binary, so keep it
  // external too. 'node-llama-cpp' has native bindings. 'jsonc-parser' (pulled
  // in transitively via @aws/durable-execution-sdk-js-cdk's source-map
  // support) has a UMD build whose factory function shadows the real
  // module-scope `require` with a same-named parameter, calling
  // `require("./impl/format")` etc. through it — esbuild's bundler
  // mis-resolves this once flattened into one file (confirmed via a real
  // "Cannot find module './impl/format'" crash in the sibling desktop app's
  // build, which bundles the exact same dependency the same way — see that
  // package's esbuild.mjs for the fuller writeup). Keeping it external here
  // too, pre-emptively, since this extension's bundle has the identical risk
  // (only manifests once deployWithDebugInfo is actually exercised at
  // runtime, not at build time — a plain build succeeding is not proof this
  // is safe to bundle).
  external: [
    "vscode",
    "node-llama-cpp",
    "esbuild",
    "typescript",
    "jsonc-parser",
  ],
  sourcemap: true,
  minify: !watch,
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("esbuild: watching...");
} else {
  await esbuild.build(options);
}
