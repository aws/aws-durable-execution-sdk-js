import { AiError } from "./errors";
import { invalid } from "./shared";

/**
 * Returns a function that loads an optional peer dependency on first use.
 *
 * Each caller passes its own literal `import()`, so a bundler such as esbuild
 * sees the package name. The `.catch` lets the bundler leave a missing package
 * to run time instead of failing the build. A failed load is not cached, so a
 * later call tries again.
 */
export function lazySdk<T>(
  load: () => Promise<T>,
  pkg: string,
  caller: string,
): () => Promise<T> {
  let sdk: Promise<T> | undefined;
  return () => {
    sdk ??= load().catch((cause: unknown) => {
      sdk = undefined;
      const code = (cause as { code?: unknown } | null)?.code;
      throw new AiError(
        code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND"
          ? `${caller} needs the ${pkg} package. Install it next to this package.`
          : `${caller} could not load the ${pkg} package. See the cause.`,
        { cause },
      );
    });
    return sdk;
  };
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
