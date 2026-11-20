import { AiError } from "./errors";
import { causeChain, invalid } from "./shared";
import type { AwsSdkClient } from "./types";

/**
 * Turns the failure to load an optional peer dependency into an `AiError`
 * that names the package.
 *
 * Each caller attaches this handler with `.catch()` directly to its own
 * literal `import()`. A bundler such as esbuild leaves a missing package to
 * run time only when the `.catch()` sits on the `import()` expression itself.
 * A handler attached through a helper function does not count, and the build
 * then fails when the package is not installed.
 */
export function sdkLoadError(
  pkg: string,
  caller: string,
): (cause: unknown) => never {
  return (cause) => {
    // A loader or test runner can wrap the error. So the whole cause chain
    // is searched for the code.
    const missing = causeChain(cause).some((link) => {
      const code = (link as { code?: unknown } | null)?.code;
      return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
    });
    throw new AiError(
      missing
        ? `${caller} needs the ${pkg} package. Install it next to this package.`
        : `${caller} could not load the ${pkg} package. See the cause.`,
      { cause },
    );
  };
}

/**
 * Caches the promise of a loaded module. A failed load is not cached, so a
 * later call tries again.
 */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
  let module: Promise<T> | undefined;
  return () => {
    module ??= load().catch((error: unknown) => {
      module = undefined;
      throw error;
    });
    return module;
  };
}

/**
 * Returns a function that gives the caller's client, or a default client that
 * `make` creates on first use and then reuses.
 */
export function lazyClient(
  explicit: AwsSdkClient | undefined,
  make: () => Promise<AwsSdkClient>,
): () => Promise<AwsSdkClient> {
  if (explicit) {
    return () => Promise.resolve(explicit);
  }
  return once(make);
}

/** Parses a reply body as JSON. */
export function parseReply(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch (cause) {
    return invalid("The decision model's reply is not JSON.", cause);
  }
}

/** Decodes a reply body that the AWS SDK returns as bytes. */
export function decode(bytes: Uint8Array | undefined): string {
  return bytes ? new TextDecoder().decode(bytes) : "";
}

/** Encodes a request as the JSON bytes that the AWS SDK sends. */
export function encode(request: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(request));
}
