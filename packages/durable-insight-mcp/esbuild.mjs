import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

// Single source of truth for the version: this package's own package.json,
// injected as a compile-time constant so server.ts never hard-codes a copy.
const { version } = JSON.parse(readFileSync("./package.json", "utf8"));

/** @type {import("esbuild").BuildOptions} */
const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  minify: !watch,
  define: {
    DURABLE_INSIGHT_MCP_VERSION: JSON.stringify(version),
  },
  // Output is ESM, but bundled CJS dependencies (the AWS SDK / smithy stack)
  // call `require("node:https")` etc. at runtime. In an ESM bundle esbuild would
  // otherwise emit a shim that throws "Dynamic require ... is not supported".
  // Recreating a real `require` from import.meta.url makes those calls work.
  // esbuild keeps the entry's shebang on line 1 and places this banner after it.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  // node-llama-cpp is a native, optional dependency of core that is only ever
  // reached through a dynamic `await import(...)` (the "local" LLM provider).
  // This server never uses it, but core references it, so keep it external
  // rather than bundling a native module.
  external: ["node-llama-cpp", "@node-llama-cpp/*"],
};

const outfile = "dist/server.js";

// The entry file (src/server.ts) begins with `#!/usr/bin/env node`; esbuild
// preserves that shebang at the top of the bundle, so no banner is needed.
const build = {
  entryPoints: ["src/server.ts"],
  outfile,
};

/**
 * The package root has no `"type": "module"`, so Node would load dist/server.js
 * as CommonJS by default — which breaks the ESM output (import.meta, imports).
 * Dropping a minimal `package.json` scoped to dist/ marks that folder as ESM
 * without changing how the rest of the package (jest, ts-jest) resolves.
 */
function markDistAsEsm() {
  writeFileSync(
    "dist/package.json",
    `${JSON.stringify({ type: "module" }, null, 2)}\n`,
  );
}

/** stdio MCP servers run as executables via `npx`; make the bin runnable. */
function makeExecutable() {
  chmodSync(outfile, 0o755);
}

if (watch) {
  const ctx = await esbuild.context({ ...common, ...build });
  await ctx.watch();
  markDistAsEsm();
  console.error("esbuild: watching...");
} else {
  await esbuild.build({ ...common, ...build });
  markDistAsEsm();
  makeExecutable();
  console.error("durable-insight-mcp: built dist/server.js");
}
