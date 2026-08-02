/**
 * On-demand OpenAPI reflection for the Studio's `httpCall` ("API methods") node
 * — the third-party counterpart to `awsSdkReflect.ts`.
 *
 * Given a vendor's own published OpenAPI/Swagger document (see
 * `openApiCatalog.ts`) this module:
 *   - fetches it once and caches it on disk, because these documents are big
 *     (Stripe ~8 MB, GitHub ~13 MB) and we don't want to re-download per click;
 *   - lists its operations (method + path + operationId + summary + tags);
 *   - reflects ONE operation into everything a `httpCall` node needs: a URL
 *     template, path/query/header parameters, and a JSON body skeleton.
 *
 * Runs on the HOST, never the webview: the webview is a browser context subject
 * to CSP and can't fetch arbitrary origins or touch disk, exactly as with the
 * AWS SDK reflection.
 *
 * Supports both OpenAPI 3.x (`servers`, `requestBody`) and Swagger 2.0
 * (`host`/`basePath`, `in: body` parameters) since vendor specs are a mix.
 * Internal `$ref`s (`#/components/…`, `#/definitions/…`) are resolved; external
 * file refs are not (such specs are excluded from the catalog).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  findApiVendor,
  findApiDirectoryEntry,
  type ApiVendor,
  type ApiDirectoryEntry,
  API_VENDORS,
  API_DIRECTORY,
  API_DIRECTORY_GENERATED_AT,
} from "@aws/durable-execution-sdk-js-visual-workflow-model";

/** One operation as shown in the browser list. */
export interface ApiOperation {
  /** Stable key identifying the operation within its spec: "GET /v1/charges". */
  key: string;
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  tags: string[];
  /** True when the operation accepts a request body. */
  hasBody: boolean;
}

export interface ApiSpecInfo {
  specId: string;
  title: string;
  version?: string;
  /** Resolved base URL (spec `servers`/`host`, or the catalog fallback). */
  baseUrl: string;
  operations: ApiOperation[];
}

/** One request parameter surfaced for editing. */
export interface ApiParam {
  name: string;
  /** "path" | "query" | "header". */
  location: string;
  required: boolean;
  type: string;
  description?: string;
}

export interface ApiOperationShape {
  key: string;
  method: string;
  /** Full URL template with `{pathParam}` placeholders still present. */
  url: string;
  operationId?: string;
  summary?: string;
  params: ApiParam[];
  /** JSON skeleton for the request body, or null when there is none. */
  bodySkeleton: Record<string, unknown> | null;
}

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
];

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cacheDirOverride: string | undefined;
/** Overridable by the host (e.g. to VS Code globalStorage). */
export function setApiSpecCacheDir(dir: string): void {
  cacheDirOverride = dir;
}
/**
 * Defaults under the OS temp dir rather than the process cwd: the contents are
 * purely a re-downloadable cache, and cwd is whatever directory the host
 * happened to start in (and may not be writable).
 */
export function getApiSpecCacheDir(): string {
  return cacheDirOverride ?? join(tmpdir(), "dar-api-spec-cache");
}

/** Parsed specs held for the session, keyed by resolved spec URL. */
const memCache = new Map<string, Record<string, unknown>>();

function cacheFileFor(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  return join(getApiSpecCacheDir(), `${hash}.txt`);
}

/**
 * Resolves a spec id (catalog entry) or a raw https URL to its document,
 * fetching and caching on first use. Only https is accepted — a spec URL comes
 * from user input, and we don't want file:// or http:// reads here.
 */
async function loadSpec(
  specIdOrUrl: string,
): Promise<{ spec: Record<string, unknown>; vendor?: ApiVendor; url: string }> {
  const vendor = findApiVendor(specIdOrUrl);
  // Featured vendor id, then community-directory id, then a raw URL.
  const directoryEntry = vendor
    ? undefined
    : findApiDirectoryEntry(specIdOrUrl);
  const url = vendor
    ? vendor.specUrl
    : (directoryEntry?.specUrl ?? specIdOrUrl);
  if (!/^https:\/\//i.test(url)) {
    throw new Error(
      `Unknown API "${specIdOrUrl}" — expected a catalog id or an https:// spec URL.`,
    );
  }

  const cached = memCache.get(url);
  if (cached) return { spec: cached, vendor, url };

  const file = cacheFileFor(url);
  let text: string | undefined;
  if (existsSync(file)) {
    try {
      text = readFileSync(file, "utf-8");
    } catch {
      text = undefined; // unreadable cache entry — refetch below
    }
  }
  if (text === undefined) {
    const res = await fetch(url, {
      headers: { accept: "application/json, application/yaml, text/plain" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new Error(
        `Could not download the API spec (HTTP ${res.status} ${res.statusText}): ${url}`,
      );
    }
    text = await res.text();
    try {
      mkdirSync(getApiSpecCacheDir(), { recursive: true });
      writeFileSync(file, text, "utf-8");
    } catch {
      // A non-writable cache dir must not break the feature.
    }
  }

  let spec: Record<string, unknown>;
  try {
    spec = (
      text.trimStart().startsWith("{") ? JSON.parse(text) : parseYaml(text)
    ) as Record<string, unknown>;
  } catch (e) {
    throw new Error(
      `The API spec at ${url} is not valid JSON or YAML: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
  memCache.set(url, spec);
  return { spec, vendor, url };
}

// ---------------------------------------------------------------------------
// $ref resolution
// ---------------------------------------------------------------------------

/**
 * Resolves internal `#/…` refs. Returns null for external refs (a different
 * file) so callers can degrade instead of emitting a broken skeleton. `seen`
 * breaks the self-referential schemas that are common in real specs.
 */
function deref(
  node: unknown,
  spec: Record<string, unknown>,
  seen: Set<string> = new Set(),
): Record<string, unknown> | null {
  if (typeof node !== "object" || node === null) return null;
  const obj = node as Record<string, unknown>;
  const ref = obj.$ref;
  if (typeof ref !== "string") return obj;
  if (!ref.startsWith("#/")) return null; // external file — unsupported
  if (seen.has(ref)) return null; // cycle
  seen.add(ref);
  let cur: unknown = spec;
  for (const seg of ref.slice(2).split("/")) {
    const key = seg.replace(/~1/g, "/").replace(/~0/g, "~");
    if (typeof cur !== "object" || cur === null) return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return deref(cur, spec, seen);
}

/** Loud, obviously-invalid host used when a spec declares no server at all. */
export const API_HOST_PLACEHOLDER = "https://REPLACE_WITH_API_HOST";

/** Base URL from OpenAPI 3 `servers`, Swagger 2 `host`, or the catalog. */
function baseUrlOf(spec: Record<string, unknown>, vendor?: ApiVendor): string {
  const servers = spec.servers;
  if (Array.isArray(servers) && servers.length > 0) {
    const first = servers[0] as { url?: unknown };
    if (typeof first?.url === "string" && /^https?:\/\//.test(first.url)) {
      return first.url.replace(/\/+$/, "");
    }
  }
  if (typeof spec.host === "string" && spec.host !== "") {
    const schemes = Array.isArray(spec.schemes) ? spec.schemes : ["https"];
    const scheme = schemes.includes("https") ? "https" : String(schemes[0]);
    const basePath =
      typeof spec.basePath === "string"
        ? spec.basePath.replace(/\/+$/, "")
        : "";
    return `${scheme}://${spec.host}${basePath}`;
  }
  const fallback = (vendor?.baseUrl ?? "").replace(/\/+$/, "");
  // Deliberately loud and obviously invalid when a spec declares no server at
  // all — matching how `generateHandler` handles a missing function ARN
  // (REPLACE_WITH_FUNCTION_ARN) — so a half-configured node is caught while
  // editing instead of silently emitting a RELATIVE url that only fails once
  // deployed. (Real case: the FEC API's spec carries no `servers`/`host`.)
  return fallback === "" ? API_HOST_PLACEHOLDER : fallback;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** The curated catalog (no network access — just the static list). */
export function listApiVendors(): ApiVendor[] {
  return API_VENDORS;
}

/**
 * The wider community-indexed directory, plus the date it was last refreshed so
 * the UI can be honest about how current the INDEX is (spec content itself is
 * always fetched live from the vendor).
 */
export function listApiDirectory(): {
  entries: ApiDirectoryEntry[];
  generatedAt: string;
} {
  return { entries: API_DIRECTORY, generatedAt: API_DIRECTORY_GENERATED_AT };
}

/** Lists every operation in a spec, sorted by path then method. */
export async function listApiOperations(
  specIdOrUrl: string,
): Promise<ApiSpecInfo> {
  const { spec, vendor } = await loadSpec(specIdOrUrl);
  const paths = spec.paths;
  if (typeof paths !== "object" || paths === null) {
    // Reachable but not an OpenAPI document: the index contains Google
    // Discovery documents and Postman collections too. Say so, rather than
    // leaving the user staring at a bare "no paths".
    const kind =
      typeof (spec as { discoveryVersion?: unknown }).discoveryVersion ===
      "string"
        ? "a Google Discovery document"
        : (spec as { info?: { _postman_id?: unknown } }).info?._postman_id !==
            undefined
          ? "a Postman collection"
          : "not an OpenAPI document";
    throw new Error(
      `This API's published spec is ${kind}, which the Studio can't read. ` +
        `Configure the request by hand with a blank API call node, or point the ` +
        `browser at an OpenAPI spec URL for this service.`,
    );
  }
  const info = (spec.info ?? {}) as { title?: unknown; version?: unknown };
  const operations: ApiOperation[] = [];

  for (const [path, itemRaw] of Object.entries(
    paths as Record<string, unknown>,
  )) {
    const item = deref(itemRaw, spec);
    if (!item) continue;
    for (const method of HTTP_METHODS) {
      const opRaw = item[method];
      if (opRaw === undefined) continue;
      const op = deref(opRaw, spec);
      if (!op) continue;
      const tags = Array.isArray(op.tags)
        ? op.tags.filter((t): t is string => typeof t === "string")
        : [];
      operations.push({
        key: `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        operationId:
          typeof op.operationId === "string" ? op.operationId : undefined,
        summary:
          typeof op.summary === "string"
            ? op.summary
            : typeof op.description === "string"
              ? op.description.split("\n")[0].slice(0, 200)
              : undefined,
        tags,
        hasBody:
          op.requestBody !== undefined ||
          (Array.isArray(op.parameters) &&
            op.parameters.some((p) => (deref(p, spec) ?? {}).in === "body")),
      });
    }
  }

  operations.sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
  return {
    specId: vendor?.id ?? specIdOrUrl,
    title: typeof info.title === "string" ? info.title : (vendor?.label ?? ""),
    version: typeof info.version === "string" ? info.version : undefined,
    baseUrl: baseUrlOf(spec, vendor),
    operations,
  };
}

/** A placeholder value for a schema, used to build the body skeleton. */
function sampleFor(
  schema: Record<string, unknown> | null,
  spec: Record<string, unknown>,
  depth = 0,
): unknown {
  if (!schema || depth > 4) return null;
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.enum) && schema.enum.length > 0)
    return schema.enum[0];
  // `oneOf`/`anyOf`/`allOf` — take the first usable branch, which is enough
  // for a starting point the author then edits.
  for (const key of ["allOf", "oneOf", "anyOf"]) {
    const branch = schema[key];
    if (Array.isArray(branch) && branch.length > 0) {
      return sampleFor(deref(branch[0], spec), spec, depth + 1);
    }
  }
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      const props = schema.properties;
      if (typeof props === "object" && props !== null) {
        const required = Array.isArray(schema.required)
          ? schema.required.filter((r): r is string => typeof r === "string")
          : [];
        // Required properties first; cap the rest so a huge schema doesn't
        // produce an unreadable skeleton.
        const entries = Object.entries(props as Record<string, unknown>);
        const ordered = [
          ...entries.filter(([k]) => required.includes(k)),
          ...entries.filter(([k]) => !required.includes(k)),
        ].slice(0, 12);
        for (const [k, v] of ordered) {
          out[k] = sampleFor(deref(v, spec), spec, depth + 1);
        }
      }
      return out;
    }
    case "array":
      return [sampleFor(deref(schema.items, spec), spec, depth + 1)];
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "string":
      return schema.format === "date-time" ? "1970-01-01T00:00:00Z" : "";
    default:
      return null;
  }
}

/** Reflects one operation into everything a `httpCall` node needs. */
export async function reflectApiOperation(
  specIdOrUrl: string,
  key: string,
): Promise<ApiOperationShape> {
  const { spec, vendor } = await loadSpec(specIdOrUrl);
  const sepIdx = key.indexOf(" ");
  if (sepIdx < 0)
    throw new Error(`Malformed operation key "${key}" (expected "GET /path").`);
  const method = key.slice(0, sepIdx).toUpperCase();
  const path = key.slice(sepIdx + 1);

  const paths = (spec.paths ?? {}) as Record<string, unknown>;
  const item = deref(paths[path], spec);
  const op = item ? deref(item[method.toLowerCase()], spec) : null;
  if (!op) throw new Error(`Operation "${key}" not found in the spec.`);

  // Path-level parameters apply to every operation on that path.
  const rawParams = [
    ...(Array.isArray(item?.parameters) ? item.parameters : []),
    ...(Array.isArray(op.parameters) ? op.parameters : []),
  ];
  const params: ApiParam[] = [];
  let bodySkeleton: Record<string, unknown> | null = null;

  for (const p of rawParams) {
    const param = deref(p, spec);
    if (!param || typeof param.name !== "string") continue;
    const location = typeof param.in === "string" ? param.in : "query";
    if (location === "body") {
      // Swagger 2.0 body parameter.
      const sample = sampleFor(deref(param.schema, spec), spec);
      if (sample && typeof sample === "object" && !Array.isArray(sample)) {
        bodySkeleton = sample as Record<string, unknown>;
      }
      continue;
    }
    if (location === "formData") continue;
    const schema = deref(param.schema, spec) ?? param;
    const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
    params.push({
      name: param.name,
      location,
      required: param.required === true,
      type: typeof t === "string" ? t : "string",
      description:
        typeof param.description === "string"
          ? param.description.split("\n")[0].slice(0, 200)
          : undefined,
    });
  }

  // OpenAPI 3 request body — prefer JSON, else the first content type.
  const requestBody = deref(op.requestBody, spec);
  const content = requestBody
    ? (deref(requestBody.content, spec) as Record<string, unknown> | null)
    : null;
  if (content) {
    const jsonKey =
      Object.keys(content).find((k) => k.includes("json")) ??
      Object.keys(content)[0];
    if (jsonKey !== undefined) {
      const media = deref(content[jsonKey], spec);
      const sample = sampleFor(deref(media?.schema, spec), spec);
      if (sample && typeof sample === "object" && !Array.isArray(sample)) {
        bodySkeleton = sample as Record<string, unknown>;
      }
    }
  }

  const base = baseUrlOf(spec, vendor);
  return {
    key,
    method,
    url: `${base}${path}`,
    operationId:
      typeof op.operationId === "string" ? op.operationId : undefined,
    summary:
      typeof op.summary === "string"
        ? op.summary
        : typeof op.description === "string"
          ? op.description.split("\n")[0].slice(0, 200)
          : undefined,
    params,
    bodySkeleton,
  };
}
