/**
 * Path resolution for the `insight://` asset server.
 *
 * Split out from main.ts so it can be tested without an Electron runtime: this
 * is the app's only filesystem-facing boundary reachable from renderer-supplied
 * input, so it is the part most worth having tests for.
 */
import { resolve, sep } from "node:path";

/** Content types for the assets the webview bundle actually requests. */
const MIME: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".wasm": "application/wasm",
  ".map": "application/json",
};

export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return MIME[path.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Map a URL pathname to an absolute path inside `root`, or null if it escapes.
 *
 * Order matters here. The pathname always starts with "/", and normalizing it
 * in that form collapses `..` against the filesystem root — `/../secret` becomes
 * `/secret` — which silently discards the traversal and makes the boundary check
 * below pass. So strip the leading separators first, so the remainder is
 * unambiguously relative, and only then join and resolve.
 *
 * Resolve before comparing, never compare the raw request string: callers hand
 * us an already-decoded pathname, so `%2e%2e%2f` arrives as `../`. The
 * `root + sep` boundary is what stops a sibling directory whose name merely
 * starts with the root's from being accepted (`/media` must not admit
 * `/media-evil`).
 */
export function resolveAssetPath(
  root: string,
  pathname: string,
): string | null {
  const absoluteRoot = resolve(root);
  // A NUL byte truncates the path in some syscalls, so reject outright.
  if (pathname.includes("\0")) return null;
  // Strip leading separators BEFORE any normalization (see above).
  const relativePart = pathname.replace(/^[/\\]+/, "");
  const candidate = resolve(absoluteRoot, relativePart);
  if (candidate !== absoluteRoot && !candidate.startsWith(absoluteRoot + sep)) {
    return null;
  }
  return candidate;
}
