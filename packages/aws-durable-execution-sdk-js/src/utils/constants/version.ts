/**
 * SDK metadata injected by Rollup at build time from package.json.
 * These values are inserted into UserAgent headers.
 *
 * At build time, Rollup replaces process.env.NPM_PACKAGE_VERSION
 * with actual values from package.json.
 *
 * SDK_NAME is a fixed string matching the cross-SDK convention:
 * aws-durable-execution-sdk-\{language\}
 * Alternate version if SDK path is within the Lambda bundled runtime.
 *
 * Defaults are provided for test environments where Rollup doesn't run
 * and process.env values are undefined.
 *
 * @internal
 */
const runtimeDir = process.env.LAMBDA_RUNTIME_DIR || "/var/runtime";
const isRuntimeBundled =
  typeof __dirname !== "undefined" && __dirname.startsWith(runtimeDir);

export const SDK_NAME = "aws-durable-execution-sdk-js";
const baseVersion = process.env.NPM_PACKAGE_VERSION || "0.0.0";
export const SDK_VERSION = isRuntimeBundled
  ? `${baseVersion}-bundled`
  : baseVersion;
