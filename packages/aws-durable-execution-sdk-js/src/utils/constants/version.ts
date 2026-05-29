/**
 * SDK metadata injected by Rollup at build time from package.json.
 * These values are inserted into UserAgent headers.
 *
 * At build time, Rollup replaces process.env.NPM_PACKAGE_VERSION
 * with actual values from package.json.
 *
 * SDK_NAME is a fixed string matching the cross-SDK convention:
 * aws-durable-execution-sdk-\{language\}
 * Alternate version if SDK is bundled into the Lambda runtime.
 *
 * Defaults are provided for test environments where Rollup doesn't run
 * and process.env values are undefined.
 *
 * @internal
 */

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const runtimeDir = process.env.LAMBDA_RUNTIME_DIR || "/var/runtime";

// Capture this module's path at module scope. `import.meta.url` is
// per-module and is only resolvable in true ESM contexts, so it must
// be referenced at top level — not from inside a function, and not
// via `new Function("return import.meta")` or `eval(...)` (both run
// their body in non-module scope, where `import.meta` is undefined).
// In CJS the rollup output makes `__filename` a normal binding, so
// the typeof guard takes that branch.
//
// The Jest unit tests never run this file directly: a manual mock
// at `__mocks__/version.ts` substitutes a hardcoded SDK_VERSION,
// which sidesteps ts-jest's TS1343 ("import.meta is only allowed
// when module is es2020+") error during CJS test compilation.
let moduleFilePath: string | undefined;
if (typeof __filename !== "undefined") {
  moduleFilePath = __filename;
} else if (typeof import.meta?.url === "string") {
  moduleFilePath = fileURLToPath(import.meta.url);
}

// Check if this code is running from a bundle in Lambda runtime
// Use file path detection to determine if running in Lambda runtime directory
function isInLambdaRuntime(): boolean {
  try {
    if (!moduleFilePath) {
      return false;
    }
    return dirname(moduleFilePath).startsWith(runtimeDir);
  } catch {
    return false;
  }
}

const isRuntimeBundled = isInLambdaRuntime();

export const SDK_NAME = "aws-durable-execution-sdk-js";
const baseVersion = process.env.NPM_PACKAGE_VERSION || "0.0.0";
export const SDK_VERSION = isRuntimeBundled
  ? `${baseVersion}-bundled`
  : baseVersion;
