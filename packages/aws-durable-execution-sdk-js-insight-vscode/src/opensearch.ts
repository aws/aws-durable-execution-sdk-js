import { SignatureV4 } from "@smithy/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";

export interface OpenSearchQueryResult {
  columns: string[];
  rows: string[][];
  count: number;
  /** Per-column numeric-type flag (aligned with `columns`) — see AthenaQueryResult.numericColumns. */
  numericColumns: boolean[];
}

export interface OpenSearchConnection {
  region: string;
  credentials: AwsCredentialIdentityProvider;
  /** Domain endpoint, e.g. "https://my-domain.us-east-1.es.amazonaws.com". */
  endpoint: string;
}

// OpenSearch SQL reports column types via the response `schema[].type`. These
// are the numeric field types; anything else (keyword/text/date/boolean/...)
// stays a string. Aligned with the numericColumns flag used by the SQL
// destinations so the webview right-aligns/plots numbers consistently.
const NUMERIC_OS_TYPES = new Set([
  "long",
  "integer",
  "short",
  "byte",
  "double",
  "float",
  "half_float",
  "scaled_float",
]);

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * SigV4-sign and send a request to the OpenSearch domain. Amazon OpenSearch
 * Service authorizes with SigV4 over the "es" service; the caller's resolved
 * credentials (profile/instance role) must be allow-listed in the domain's
 * access policy. Uses native fetch — no OpenSearch client library.
 *
 * No query-string params are used (paths only), so the signed canonical
 * request and the fetched URL stay identical.
 */
async function signedFetch(
  conn: OpenSearchConnection,
  method: string,
  url: string,
  body?: string,
): Promise<Response> {
  const signer = new SignatureV4({
    service: "es",
    region: conn.region,
    credentials: conn.credentials,
    sha256: Sha256,
  });

  const u = new URL(url);
  const headers: Record<string, string> = { host: u.host };
  if (body != null) headers["content-type"] = "application/json";

  const signed = await signer.sign({
    method,
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port ? Number(u.port) : undefined,
    path: u.pathname,
    headers,
    body,
  });

  return fetch(url, {
    method,
    headers: signed.headers as Record<string, string>,
    body,
  });
}

/**
 * Run a query via the OpenSearch SQL plugin (POST _plugins/_sql) and normalize
 * the {schema, datarows} response into the shared tabular result shape.
 */
export async function runOpenSearchQuery(
  opts: OpenSearchConnection & { sql: string },
): Promise<OpenSearchQueryResult> {
  const endpoint = opts.endpoint.replace(/\/$/, "");
  const url = `${endpoint}/_plugins/_sql`;
  const res = await signedFetch(
    opts,
    "POST",
    url,
    JSON.stringify({ query: opts.sql }),
  );

  const text = await res.text();
  if (!res.ok) {
    // The SQL plugin returns a JSON error body with reason/details — surface it
    // so the model (agent mode) can correct the query.
    let detail = text.slice(0, 800);
    try {
      const err = JSON.parse(text);
      detail = err?.error?.reason || err?.error?.details || detail;
    } catch {
      // keep raw text
    }
    throw new Error(
      `OpenSearch SQL error (${res.status} ${res.statusText}): ${detail}`,
    );
  }

  const data = JSON.parse(text) as {
    schema?: { name?: string; alias?: string; type?: string }[];
    datarows?: unknown[][];
  };
  const schema = data.schema ?? [];
  const columns = schema.map((c) => c.alias || c.name || "?");
  const numericColumns = schema.map((c) =>
    c.type != null ? NUMERIC_OS_TYPES.has(c.type) : false,
  );
  const rows = (data.datarows ?? []).map((row) => row.map(cellToString));

  return { columns, rows, count: rows.length, numericColumns };
}

/**
 * Fetch a single record by executionArn for the row-detail drill-down. The
 * exporter indexes each record with _id = executionArn, so this is a direct
 * GET _doc/<id> (precise, no query needed). Unpacks _source into flat
 * top-level string fields to match the shape RecordDetail.tsx expects.
 */
export async function fetchOpenSearchRecord(
  opts: OpenSearchConnection & { index: string; executionArn: string },
): Promise<Record<string, string> | undefined> {
  const endpoint = opts.endpoint.replace(/\/$/, "");
  const url = `${endpoint}/${opts.index}/_doc/${encodeURIComponent(
    opts.executionArn,
  )}`;
  const res = await signedFetch(opts, "GET", url);

  if (res.status === 404) return undefined;
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `OpenSearch get failed (${res.status} ${res.statusText}): ${text.slice(0, 500)}`,
    );
  }

  const data = JSON.parse(text) as { _source?: Record<string, unknown> };
  const src = data._source;
  if (!src || typeof src !== "object") return undefined;

  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(src)) {
    if (val == null) continue;
    out[key] = typeof val === "object" ? JSON.stringify(val) : String(val);
  }
  return out;
}

/**
 * Lightweight connectivity/auth probe: signed GET of the cluster root, which
 * confirms the endpoint is reachable and the caller's SigV4 identity is
 * authorized by the domain access policy.
 */
export async function pingOpenSearch(
  conn: OpenSearchConnection,
): Promise<string> {
  const endpoint = conn.endpoint.replace(/\/$/, "");
  const res = await signedFetch(conn, "GET", `${endpoint}/`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `OpenSearch connection failed (${res.status} ${res.statusText}): ${text.slice(0, 300)}`,
    );
  }
  try {
    const info = JSON.parse(text) as {
      cluster_name?: string;
      version?: { number?: string };
    };
    return `Connected to cluster "${info.cluster_name ?? "?"}" (v${info.version?.number ?? "?"}).`;
  } catch {
    return "Connected to the OpenSearch domain.";
  }
}
