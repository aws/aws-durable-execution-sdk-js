// Reproduces the AWS CDK NodejsFunction bundling path that downstream
// consumers hit at Lambda cold start. Runs both the CJS scenario
// (CDK's default OutputFormat.CJS, which crashed in 1.1.3-1.1.5 due
// to PR #539 / #546 / #562) and the ESM scenario (OutputFormat.ESM)
// to make sure the fix doesn't break the ESM path.
//
// In the CJS scenario the crash happened because `dist/index.mjs`
// contained constructs referencing top-level `import.meta.url`. When a
// Lambda handler that imports the SDK got bundled to CJS by esbuild,
// those `import.meta.url` references survived as literals in CJS
// context where `import.meta` is undefined → `TypeError:
// fileURLToPath(undefined)` at module init.
//
// Note: `mainFields: ['main', 'module']` does NOT save us. The SDK's
// `exports` map takes precedence, so esbuild still resolves
// `@aws/durable-execution-sdk-js` to `dist/index.mjs` via the `import`
// condition.

import { build } from "esbuild";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const sdkRequire = createRequire(import.meta.url);
const sdkSource = dirname(
  sdkRequire.resolve("@aws/durable-execution-sdk-js"),
).replace(/\/dist-cjs$/, "");
const lambdaClientSource = dirname(
  sdkRequire.resolve("@aws-sdk/client-lambda"),
).replace(/\/dist[^/]*$/, "");

// Mirror a real CDK Lambda bundling layout. The bundling root must
// live OUTSIDE the workspace (this package has `"type": "module"`,
// which makes esbuild resolve the SDK to its CJS dist instead of the
// ESM dist — masking the bug). We use os.tmpdir() instead of the
// package directory.
//
//  - bundleRoot: the project root the user-authored handler lives in,
//    plus a node_modules tree containing the SDK. CDK's NodejsFunction
//    runs esbuild with the entry's project root as cwd, so esbuild's
//    package resolution sees the SDK as a top-level installed dep.
//    The entry file is written here too so its parent package.json is
//    bundleRoot's (no "type": "module" inheritance).
//  - loadDir: where we write the bundled artifact. We declare
//    `"type": "commonjs"` so Node loads .js bundles as CJS the way
//    Lambda's CJS runtime does. The .mjs ESM bundle is loaded by
//    file extension regardless.
const tmp = mkdtempSync(join(tmpdir(), "cdk-bundling-integration-test-"));
const bundleRoot = join(tmp, "bundle-root");
const loadDir = join(tmp, "load-dir");
mkdirSync(bundleRoot, { recursive: true });
mkdirSync(loadDir, { recursive: true });
writeFileSync(
  join(bundleRoot, "package.json"),
  JSON.stringify({ name: "lambda-handler", version: "0.0.0" }),
);
writeFileSync(
  join(loadDir, "package.json"),
  JSON.stringify({ type: "commonjs" }),
);

// Write the handler entry inside bundleRoot. `import` syntax in a
// .ts file is the canonical CDK Lambda shape.
const entryPath = join(bundleRoot, "entry.ts");
writeFileSync(
  entryPath,
  `import { withDurableExecution } from "@aws/durable-execution-sdk-js";

export const handler = async () => ({ ok: typeof withDurableExecution });
`,
);

// Symlink the SDK into bundleRoot/node_modules so esbuild's package
// resolution treats it as a normal installed dependency.
mkdirSync(join(bundleRoot, "node_modules", "@aws"), { recursive: true });
symlinkSync(
  sdkSource,
  join(bundleRoot, "node_modules", "@aws", "durable-execution-sdk-js"),
  "dir",
);

// CDK's NodejsFunction marks @aws-sdk/* as external (the Lambda
// runtime ships it pre-installed); the produced bundle emits
// require/import calls against `@aws-sdk/client-lambda`. Symlink the
// real package — it's already installed transitively as a dep of the
// SDK — into loadDir/node_modules so the resolution succeeds at load.
mkdirSync(join(loadDir, "node_modules", "@aws-sdk"), { recursive: true });
symlinkSync(
  lambdaClientSource,
  join(loadDir, "node_modules", "@aws-sdk", "client-lambda"),
  "dir",
);

// Bundle flags mirror aws-cdk-lib NodejsFunction's defaults.
// mainFields flips depending on output format (CDK does the same).
// The packages we mark external are the ones CDK marks external by
// default (LAMBDA_NODEJS_SDK_V3_EXCLUDE_SMITHY_PACKAGES feature flag).
async function runScenario({
  label,
  format,
  outFile,
  loadBundle,
  banner,
  // CDK NodejsFunction marks @aws-sdk/* and @smithy/* as external by
  // default. `bundleAwsSDK: true` opts into bundling them, which makes
  // esbuild trace and inline the AWS SDK code instead of leaving
  // require/import calls in the bundle.
  bundleAwsSDK = false,
}) {
  const outPath = join(loadDir, outFile);
  await build({
    entryPoints: [entryPath],
    absWorkingDir: bundleRoot,
    bundle: true,
    platform: "node",
    format,
    target: "node22",
    minify: true,
    mainFields: format === "esm" ? ["module", "main"] : ["main", "module"],
    external: bundleAwsSDK ? [] : ["@aws-sdk/*", "@smithy/*"],
    outfile: outPath,
    banner: banner ? { js: banner } : undefined,
    logLevel: "error",
  });
  console.log(`✓ [${label}] esbuild produced a ${format.toUpperCase()} bundle`);

  const bundled = await loadBundle(outPath);
  if (typeof bundled.handler !== "function") {
    throw new Error(
      `[${label}] handler is not a function (got ${typeof bundled.handler})`,
    );
  }
  const result = await bundled.handler();
  if (result?.ok !== "function") {
    throw new Error(
      `[${label}] handler did not return expected shape: ${JSON.stringify(result)}`,
    );
  }
  console.log(`✓ [${label}] bundled handler loaded and ran without errors`);
}

try {
  await runScenario({
    label: "CJS",
    format: "cjs",
    outFile: "index.js",
    loadBundle: (out) => {
      // require()ing the bundle runs its top-level module init, which
      // is where the production crash happens.
      const requireFromLoadDir = createRequire(join(loadDir, "package.json"));
      return requireFromLoadDir(out);
    },
  });
  await runScenario({
    label: "ESM",
    format: "esm",
    outFile: "index.mjs",
    // .mjs is unambiguously ESM regardless of the nearest package.json.
    loadBundle: (out) => import(pathToFileURL(out).href),
  });
  // CDK's NodejsFunction supports a `banner` bundling option, commonly
  // used with ESM output to make `require` available inside the bundle
  // (some npm packages still call `require` even when imported via
  // ESM). Verifies the SDK behaves correctly when a polyfilled
  // `require` is present in the ESM scope.
  await runScenario({
    label: "ESM + require polyfill",
    format: "esm",
    outFile: "index-polyfilled.mjs",
    loadBundle: (out) => import(pathToFileURL(out).href),
    banner:
      "import { createRequire } from 'module';" +
      "const require = createRequire(import.meta.url);",
  });
  // bundleAwsSDK opts into inlining @aws-sdk/* and @smithy/*. Pulls in
  // a much larger graph of transitive deps and exercises a different
  // resolution path through the bundler.
  await runScenario({
    label: "CJS + bundleAwsSDK",
    format: "cjs",
    outFile: "index-bundled-sdk.js",
    bundleAwsSDK: true,
    loadBundle: (out) => {
      const requireFromLoadDir = createRequire(join(loadDir, "package.json"));
      return requireFromLoadDir(out);
    },
  });
  await runScenario({
    label: "ESM + bundleAwsSDK",
    format: "esm",
    outFile: "index-bundled-sdk.mjs",
    bundleAwsSDK: true,
    loadBundle: (out) => import(pathToFileURL(out).href),
  });
  console.log("✓ CDK bundling integration test passed");
} catch (error) {
  console.error("✗ CDK bundling integration test failed:");
  console.error(error);
  process.exit(1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
