/**
 * On-demand AWS SDK v3 reflection for the "AWS SDK method" studio node.
 *
 * The AWS SDK ships one npm package per service (`@aws-sdk/client-<svc>`), and
 * those packages depend only on shared `@smithy/*` / `@aws-sdk/*` packages that
 * are already hoisted in our tree. So we can, at runtime and on the host:
 *   - resolve (or lazily `npm install`) a client package, pinned to our SDK
 *     version and restricted to the `@aws-sdk/client-*` scope;
 *   - list its operations from the exported `*Command` classes;
 *   - reflect an operation's input shape from the runtime `command.schema`
 *     (via `@smithy/core/schema`'s `NormalizedSchema`) into a field list + a
 *     JSON skeleton.
 *
 * The webview is a browser context and cannot `require` these packages, so all
 * reflection happens here and the results are posted to the webview.
 *
 * Note: client schemas strip validation traits (clients don't validate input),
 * so `@required` is not available. We surface a best-effort `required` hint from
 * binding traits (httpLabel/httpPayload/hostLabel) only.
 */

import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// A real Node `require` that resolves against the on-disk node_modules tree
// (esbuild leaves dynamic `require(var)` calls untouched, so nothing here gets
// bundled into the extension).
const nodeRequire = createRequire(__filename);

/** Only ever touch first-party AWS SDK v3 service clients. */
const CLIENT_PACKAGE_RE = /^@aws-sdk\/client-[a-z0-9-]+$/;

export type SdkFieldType =
  | "string"
  | "number"
  | "boolean"
  | "blob"
  | "timestamp"
  | "list"
  | "map"
  | "struct"
  | "document"
  | "unknown";

/** One top-level member of an operation's input. */
export interface SdkField {
  name: string;
  type: SdkFieldType;
  /** Best-effort only (binding traits); client schemas omit `@required`. */
  required: boolean;
}

/** Reflected input shape of one operation. */
export interface SdkActionShape {
  command: string;
  fields: SdkField[];
  /** A JSON skeleton with placeholder values by type. */
  skeleton: Record<string, unknown>;
}

/** One operation of a service client. */
export interface SdkAction {
  /** Operation name without the `Command` suffix, e.g. `PutItem`. */
  name: string;
  /** The command class name, e.g. `PutItemCommand`. */
  command: string;
}

/** A client's operations plus its client class (for codegen). */
export interface SdkClientInfo {
  clientPackage: string;
  /** The `*Client` export, e.g. `DynamoDBClient`. */
  clientClass: string;
  actions: SdkAction[];
}

/** The SDK version we pin on-demand installs to (matches our own clients). */
let pinnedVersionCache: string | undefined;
function pinnedVersion(): string {
  if (!pinnedVersionCache) {
    try {
      pinnedVersionCache = nodeRequire(
        "@aws-sdk/client-lambda/package.json",
      ).version;
    } catch {
      pinnedVersionCache = "latest";
    }
  }
  return pinnedVersionCache as string;
}

function assertClientPackage(clientPackage: string): void {
  if (!CLIENT_PACKAGE_RE.test(clientPackage)) {
    throw new Error(
      `Refusing to load "${clientPackage}": only @aws-sdk/client-* packages are allowed.`,
    );
  }
}

/** The root of our on-disk node_modules tree (where installed clients live). */
function moduleRoot(): string {
  // Resolve an always-present client, then walk up out of node_modules/@aws-sdk.
  const p = nodeRequire.resolve("@aws-sdk/client-lambda/package.json");
  const marker = `${sep()}node_modules${sep()}`;
  const idx = p.indexOf(marker);
  return idx >= 0 ? p.slice(0, idx) : process.cwd();
}

function sep(): string {
  return process.platform === "win32" ? "\\" : "/";
}

/**
 * Where on-demand clients are installed — an isolated directory with its own
 * node_modules, so installs never mutate (or trip peer conflicts in) the
 * workspace tree. Overridable by the extension (e.g. to globalStorage).
 */
let cacheDirOverride: string | undefined;
export function setSdkCacheDir(dir: string): void {
  cacheDirOverride = dir;
}
export function getSdkCacheDir(): string {
  return cacheDirOverride ?? join(moduleRoot(), ".aws-sdk-cache");
}

/** A `require` rooted at the isolated cache dir. */
function cacheRequire(): NodeRequire {
  return createRequire(join(getSdkCacheDir(), "noop.js"));
}

/** True if a client resolves from the workspace tree (one of our own deps). */
function resolvableInWorkspace(clientPackage: string): boolean {
  try {
    nodeRequire.resolve(clientPackage);
    return true;
  } catch {
    return false;
  }
}

/** True if a client is already present in the isolated cache. */
function resolvableInCache(clientPackage: string): boolean {
  try {
    cacheRequire().resolve(clientPackage);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a client package is loadable, lazily installing it (pinned + scoped)
 * into the isolated cache when it isn't already in the workspace or cache.
 */
export async function ensureClient(clientPackage: string): Promise<boolean> {
  assertClientPackage(clientPackage);
  if (
    resolvableInWorkspace(clientPackage) ||
    resolvableInCache(clientPackage)
  ) {
    return true;
  }
  const dir = getSdkCacheDir();
  mkdirSync(dir, { recursive: true });
  // A private, non-workspace package.json keeps npm from engaging the monorepo
  // workspace resolution (and its unrelated peer conflicts) here.
  const pkgJson = join(dir, "package.json");
  if (!existsSync(pkgJson)) {
    writeFileSync(
      pkgJson,
      JSON.stringify({ name: "aws-sdk-client-cache", private: true }, null, 2),
    );
  }
  const spec = `${clientPackage}@${pinnedVersion()}`;
  await execFileAsync(
    // On Windows `npm` is a shell script; execFile needs the .cmd shim or it
    // fails with ENOENT.
    process.platform === "win32" ? "npm.cmd" : "npm",
    [
      "install",
      "--prefix",
      dir,
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
      spec,
    ],
    { cwd: dir, timeout: 180_000 },
  );
  cacheRequire().resolve(clientPackage);
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadClient(clientPackage: string): Record<string, any> {
  assertClientPackage(clientPackage);
  const req = resolvableInWorkspace(clientPackage)
    ? nodeRequire
    : cacheRequire();
  return req(clientPackage);
}

/** List a client's operations (sorted), loading it on demand if needed. */
/**
 * The client's `*Client` export name, e.g. `DynamoDBClient`. Prefers the
 * dedicated low-level client over the aggregated (`DynamoDB`) class.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function clientClassOf(mod: Record<string, any>): string {
  const clients = Object.keys(mod).filter(
    (k) =>
      k.endsWith("Client") &&
      k !== "Client" &&
      !k.startsWith("_") &&
      !k.startsWith("$"),
  );
  if (clients.length === 0) {
    throw new Error("Could not find a *Client export in the package.");
  }
  return clients[0];
}

/** List a client's operations (sorted) + its client class, loading on demand. */
export async function listActions(
  clientPackage: string,
): Promise<SdkClientInfo> {
  await ensureClient(clientPackage);
  const mod = loadClient(clientPackage);
  const actions = Object.keys(mod)
    .filter((k) => k.endsWith("Command") && k !== "$Command")
    .map((command) => ({ command, name: command.replace(/Command$/, "") }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { clientPackage, clientClass: clientClassOf(mod), actions };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizedSchema(): any {
  return nodeRequire("@smithy/core/schema").NormalizedSchema;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function typeOf(ns: any): SdkFieldType {
  try {
    if (ns.isListSchema()) return "list";
    if (ns.isMapSchema()) return "map";
    if (ns.isStructSchema()) return "struct";
    if (ns.isBlobSchema()) return "blob";
    if (ns.isBooleanSchema()) return "boolean";
    if (
      ns.isNumericSchema() ||
      ns.isBigIntegerSchema() ||
      ns.isBigDecimalSchema()
    )
      return "number";
    if (ns.isTimestampSchema()) return "timestamp";
    if (ns.isDocumentSchema()) return "document";
    if (ns.isStringSchema()) return "string";
  } catch {
    /* fall through */
  }
  return "unknown";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isRequiredHint(ns: any): boolean {
  try {
    const t = ns.getMergedTraits?.() ?? {};
    return Boolean(t.httpLabel || t.httpPayload || t.hostLabel);
  } catch {
    return false;
  }
}

const MAX_DEPTH = 4;

/** Build a placeholder value for a (normalized) schema, depth-capped. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function skeletonFor(ns: any, depth: number, seen: Set<string>): unknown {
  const type = typeOf(ns);
  switch (type) {
    case "string":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "blob":
      return "";
    case "timestamp":
      return "";
    case "document":
      return {};
    case "list": {
      if (depth >= MAX_DEPTH) return [];
      try {
        const el = skeletonFor(ns.getValueSchema(), depth + 1, seen);
        return el === undefined ? [] : [el];
      } catch {
        return [];
      }
    }
    case "map": {
      return {};
    }
    case "struct": {
      let name = "";
      try {
        name = ns.getName?.() ?? "";
      } catch {
        /* ignore */
      }
      if (depth >= MAX_DEPTH || (name && seen.has(name))) return {};
      const nextSeen = name ? new Set(seen).add(name) : seen;
      const obj: Record<string, unknown> = {};
      try {
        for (const [key, member] of Object.entries(ns.getMemberSchemas())) {
          obj[key] = skeletonFor(member, depth + 1, nextSeen);
        }
      } catch {
        /* ignore */
      }
      return obj;
    }
    default:
      return null;
  }
}

/**
 * Reflect one operation's input shape into a field list + JSON skeleton.
 * Loads the client on demand if needed.
 */
export async function reflectAction(
  clientPackage: string,
  commandName: string,
): Promise<SdkActionShape> {
  await ensureClient(clientPackage);
  const mod = loadClient(clientPackage);
  const CommandCtor = mod[commandName];
  if (typeof CommandCtor !== "function") {
    throw new Error(`Unknown command ${commandName} in ${clientPackage}.`);
  }
  const NS = normalizedSchema();
  // The operation schema is [type, ns, name, traits, inputThunk, outputThunk].
  const opSchema = new CommandCtor({}).schema;
  const inputRef = Array.isArray(opSchema) ? opSchema[4] : undefined;

  const fields: SdkField[] = [];
  const skeleton: Record<string, unknown> = {};
  if (inputRef !== undefined) {
    const input = NS.of(inputRef);
    if (input.isStructSchema()) {
      for (const [name, member] of Object.entries(input.getMemberSchemas())) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m = member as any;
        fields.push({ name, type: typeOf(m), required: isRequiredHint(m) });
        skeleton[name] = skeletonFor(m, 1, new Set());
      }
    }
  }
  return { command: commandName, fields, skeleton };
}
