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

const runtimeDir = process.env.LAMBDA_RUNTIME_DIR || "/var/runtime";

// Check if this code is running from a bundle in Lambda runtime
// Use environment variables and stack trace analysis
function isInLambdaRuntime(): boolean {
  try {
    // Check if we're in Lambda environment
    const isLambda =
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.LAMBDA_RUNTIME_DIR ||
      process.env._HANDLER;

    if (isLambda) {
      // Check if the runtime directory environment variable points to /var/runtime
      // This indicates we're using the runtime-bundled version
      if (
        process.env.LAMBDA_RUNTIME_DIR &&
        process.env.LAMBDA_RUNTIME_DIR.startsWith("/var/runtime")
      ) {
        return true;
      }

      // Check stack trace for runtime paths as fallback
      const stack = new Error().stack || "";
      if (stack.includes("/var/runtime")) {
        return true;
      }
    }
  } catch {}

  return false;
}

const isRuntimeBundled = isInLambdaRuntime();

export const SDK_NAME = "aws-durable-execution-sdk-js";
const baseVersion = process.env.NPM_PACKAGE_VERSION || "0.0.0";
export const SDK_VERSION = isRuntimeBundled
  ? `${baseVersion}-bundled`
  : baseVersion;
