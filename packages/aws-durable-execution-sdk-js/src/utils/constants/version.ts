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
// Use simple environment-based detection without import.meta
function isInLambdaRuntime(): boolean {
  try {
    // Check if we're in a Jest test environment first
    if (
      typeof process !== "undefined" &&
      process.env &&
      process.env.NODE_ENV === "test"
    ) {
      return false;
    }

    // Check for Lambda runtime environment variables
    if (typeof process !== "undefined" && process.env) {
      // Lambda runtime sets these environment variables
      const hasLambdaRuntime =
        process.env.AWS_LAMBDA_RUNTIME_API ||
        process.env.LAMBDA_RUNTIME_DIR ||
        process.env._LAMBDA_RUNTIME_LOAD_TIME;

      if (hasLambdaRuntime) {
        return true;
      }
    }

    // Fallback: check if __filename is in /var/runtime (CJS only)
    if (typeof __filename !== "undefined") {
      return __filename.startsWith(runtimeDir);
    }

    // For ESM without import.meta, we can't reliably detect, so assume false
    return false;
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
