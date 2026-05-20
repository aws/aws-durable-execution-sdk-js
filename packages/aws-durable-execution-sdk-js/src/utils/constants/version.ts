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

// Check if this code is running from a bundle in Lambda runtime
// Use file path detection to determine if running in Lambda runtime directory
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

    // File path detection for reliable detection
    let currentFilePath: string | undefined;

    // CJS: use __filename if available
    if (typeof __filename !== "undefined") {
      currentFilePath = __filename;
    } else {
      // ESM: use import.meta.url
      try {
        // Use Function constructor to avoid TypeScript compilation errors in Jest
        const getImportMeta = new Function("return import.meta");
        const importMeta = getImportMeta();
        if (importMeta && importMeta.url) {
          currentFilePath = fileURLToPath(importMeta.url);
        }
      } catch {
        // Fallback if import.meta is not available
      }
    }

    if (currentFilePath) {
      const libraryDirectory = dirname(currentFilePath);
      return libraryDirectory.startsWith(runtimeDir);
    }

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
