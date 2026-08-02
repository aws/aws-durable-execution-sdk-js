import esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

// `source-map`@0.7 (used by the insight-vscode package's
// remoteDebug/mapBridge.ts, bundled into main.js via host.ts's debugRunner
// import) parses mappings in wasm and loads `lib/mappings.wasm` at runtime
// via `path.join(__dirname, "mappings.wasm")` — in the flattened CJS bundle
// __dirname is dist/, so the sidecar must sit next to main.js or the first
// debug run dies with ENOENT (the build itself succeeds either way).
// Resolved from the insight-vscode package (where esbuild also resolves the
// import, per Node resolution) so the wasm matches the exact 0.7.x whose JS
// gets bundled — the workspace ROOT hoists an incompatible 0.6.x, which is
// also why `source-map` can't just be external here.
const requireFromInsightVscode = createRequire(
  new URL(
    "../aws-durable-execution-sdk-js-insight-vscode/package.json",
    import.meta.url,
  ),
);
mkdirSync("dist", { recursive: true });
copyFileSync(
  requireFromInsightVscode.resolve("source-map/lib/mappings.wasm"),
  "dist/mappings.wasm",
);

/** @type {import("esbuild").BuildOptions} */
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
  // Provided by the Electron runtime, or required at runtime and not bundleable:
  //  - electron: the shell.
  //  - esbuild: used at runtime to bundle generated workflow handlers on deploy.
  //  - node-llama-cpp (+ its platform packages): native, top-level-await; only
  //    used by the optional "local" LLM provider, loaded via dynamic import.
  //  - typescript: pulled in transitively by codegen; ships its own runtime.
  //  - jsonc-parser: pulled in transitively via @aws/durable-execution-sdk-js-cdk's
  //    source-map support (locateNodeCodePositions). Its UMD build's factory
  //    function takes a parameter literally named `require` (shadowing the
  //    real module-scope `require`) and calls `require("./impl/format")` etc.
  //    through it — esbuild's bundler mis-resolves this once flattened into
  //    one file (confirmed: real "Cannot find module './impl/format'" crash
  //    at runtime, not a hypothetical). Keeping it external (loaded via
  //    Node's own `require` from node_modules at runtime, same as the other
  //    externals here) avoids the bundler ever touching its internal requires.
  // awsSdkReflect's dynamic require of on-demand clients stays external too.
  external: [
    "electron",
    "esbuild",
    "typescript",
    "node-llama-cpp",
    "@node-llama-cpp/*",
    "jsonc-parser",
  ],
};

await esbuild.build({
  ...common,
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
});

await esbuild.build({
  ...common,
  entryPoints: ["src/preload.ts"],
  outfile: "dist/preload.js",
});

console.log("insight-desktop: built dist/main.js + dist/preload.js");
