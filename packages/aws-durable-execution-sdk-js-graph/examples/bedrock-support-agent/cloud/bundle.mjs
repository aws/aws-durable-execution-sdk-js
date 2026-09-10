#!/usr/bin/env node
/**
 * Bundle the Bedrock support-agent cloud entry into a single self-contained CJS file for Lambda.
 * Modeled on the package's known-good `cloud/bundle.mjs`.
 *
 * Run inside the node:22 Docker container (the host node may be too old to run esbuild):
 *
 *   docker run --rm -v "$PWD":/w -w /w -u $(id -u):$(id -g) -e HOME=/tmp node:22 \
 *     node packages/aws-durable-execution-sdk-js-graph/examples/bedrock-support-agent/cloud/bundle.mjs
 *
 * Output:
 *   packages/aws-durable-execution-sdk-js-graph/examples/bedrock-support-agent/cloud/build/index.js
 *   (CJS, handler=`handler`)
 *
 * Both the core SDK (`@aws/durable-execution-sdk-js`, a peer dependency) and
 * `@aws-sdk/client-bedrock-runtime` resolve from the monorepo ROOT node_modules — esbuild's
 * default node resolution walks up to the root and finds them, so both get bundled in and the zip
 * is fully self-contained (`external: []`). We do NOT rely on the Lambda runtime's built-in AWS
 * SDK: bundling the Bedrock client guarantees the exact version the example was verified against.
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
    js: "/* Bedrock support-agent example — bundled cloud handler (esbuild, target node22, CJS). */",
  },
});

const bytes = statSync(outfile).size;
console.log(`BUNDLE_OK outfile=${outfile} bytes=${bytes}`);
