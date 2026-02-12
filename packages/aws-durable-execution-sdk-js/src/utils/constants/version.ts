/**
 * SDK metadata injected by Rollup at build time from package.json.
 *
 * At build time, Rollup replaces process.env.NPM_PACKAGE_NAME and
 * process.env.NPM_PACKAGE_VERSION with actual values from package.json.
 *
 * Defaults are provided for test environments where Rollup doesn't run
 * and process.env values are undefined.
 *
 * @internal
 */
export const SDK_NAME =
  process.env.NPM_PACKAGE_NAME || "@aws/durable-execution-sdk-js";
export const SDK_VERSION = process.env.NPM_PACKAGE_VERSION || "0.0.0";
