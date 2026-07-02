// Verifies that isInLambdaRuntime() correctly detects whether the SDK
// is running from inside the Lambda runtime directory, in BOTH CJS
// and ESM module contexts. The function is invoked at module-load
// time and the result is baked into the SDK_VERSION exposed via the
// LambdaClient's customUserAgent — so we spawn a child Node process
// for each scenario, instantiate DurableExecutionApiClient, and
// inspect the resulting UserAgent for the `-bundled` suffix.
//
// We can't unit-test this in Jest: the real version module reads
// `import.meta.url` at top level, which ts-jest cannot compile
// (Jest forces module: commonjs). The Jest config substitutes a
// hardcoded mock for `version.ts`, so the real detection logic
// never runs under Jest at all.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const sdkRequire = createRequire(import.meta.url);
const sdkRoot = dirname(
  sdkRequire.resolve("@aws/durable-execution-sdk-js"),
).replace(/\/dist-cjs$/, "");

// Probe script: instantiates DurableExecutionApiClient (which builds
// a LambdaClient with the SDK's name + version baked into
// customUserAgent) and prints the customUserAgent as JSON.
const cjsProbe = `
const sdk = require("@aws/durable-execution-sdk-js");
const c = new sdk.DurableExecutionApiClient();
process.stdout.write(JSON.stringify(c.client.config.customUserAgent));
`;

const esmProbe = `
import * as sdk from "@aws/durable-execution-sdk-js";
const c = new sdk.DurableExecutionApiClient();
process.stdout.write(JSON.stringify(c.client.config.customUserAgent));
`;

function probe({ moduleSystem, env }) {
  const inputType = moduleSystem === "esm" ? "module" : "commonjs";
  const script = moduleSystem === "esm" ? esmProbe : cjsProbe;
  const result = spawnSync(
    process.execPath,
    [`--input-type=${inputType}`, "-e", script],
    {
      encoding: "utf8",
      env: {
        // Start from a clean slate so the parent's NODE_ENV (set by
        // some CI configurations) doesn't leak into the child.
        PATH: process.env.PATH,
        ...env,
      },
    },
  );
  if (result.status !== 0) {
    throw new Error(`child process exited ${result.status}: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function getSdkVersionEntry(customUserAgent) {
  const entry = customUserAgent.find(
    ([name]) => name === "aws-durable-execution-sdk-js",
  );
  if (!entry) {
    throw new Error(
      `customUserAgent missing SDK entry: ${JSON.stringify(customUserAgent)}`,
    );
  }
  return entry[1];
}

const scenarios = [
  {
    label: "CJS, runtime dir matches SDK install",
    moduleSystem: "cjs",
    env: { LAMBDA_RUNTIME_DIR: sdkRoot },
    expectBundled: true,
  },
  {
    label: "CJS, runtime dir does not match",
    moduleSystem: "cjs",
    env: { LAMBDA_RUNTIME_DIR: "/var/runtime" },
    expectBundled: false,
  },
  {
    label: "ESM, runtime dir matches SDK install",
    moduleSystem: "esm",
    env: { LAMBDA_RUNTIME_DIR: sdkRoot },
    expectBundled: true,
  },
  {
    label: "ESM, runtime dir does not match",
    moduleSystem: "esm",
    env: { LAMBDA_RUNTIME_DIR: "/var/runtime" },
    expectBundled: false,
  },
];

let failed = 0;
for (const scenario of scenarios) {
  try {
    const ua = probe(scenario);
    const version = getSdkVersionEntry(ua);
    const isBundled = version.endsWith("-bundled");
    if (isBundled !== scenario.expectBundled) {
      throw new Error(
        `expected SDK_VERSION to ${scenario.expectBundled ? "" : "NOT "}` +
          `end with "-bundled", got "${version}"`,
      );
    }
    console.log(`✓ [${scenario.label}] SDK_VERSION = "${version}"`);
  } catch (error) {
    console.error(`✗ [${scenario.label}] ${error.message}`);
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`✗ ${failed} scenario(s) failed`);
  process.exit(1);
}
console.log("✓ Lambda runtime detection integration test passed");
