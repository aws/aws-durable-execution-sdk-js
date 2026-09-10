#!/usr/bin/env node
/**
 * Bundle the cloud entry into a single self-contained CJS file for Lambda.
 *
 * Run inside the node:22 Docker container (the host node is v16 and cannot run esbuild here):
 *
 *   docker run --rm -v "$PWD":/w -w /w -u $(id -u):$(id -g) -e HOME=/tmp node:22 \
 *     node packages/aws-durable-execution-sdk-js-graph/cloud/bundle.mjs
 *
 * Output: packages/aws-durable-execution-sdk-js-graph/cloud/build/index.js  (CJS, handler=`handler`)
 *
 * The core SDK (`@aws/durable-execution-sdk-js`) is a PEER dependency of the graph package and
 * is NOT installed under the graph package's own node_modules, but it IS present in the
 * monorepo ROOT node_modules. esbuild's default node resolution walks up to the root and finds
 * it, so it gets bundled in. Nothing is left external — the zip is fully self-contained.
 */

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { statSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "entry.mjs");
const outfile = resolve(here, "build", "index.js");

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: false,
  minify: false,
  external: [],
  logLevel: "info",
  banner: {
    js: "/* Durable Graph POC — bundled cloud handler (esbuild, target node22, CJS). */",
  },
});

const bytes = statSync(outfile).size;
console.log(`BUNDLE_OK outfile=${outfile} bytes=${bytes}`);
