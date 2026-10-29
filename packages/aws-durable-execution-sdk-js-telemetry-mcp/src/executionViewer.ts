/**
 * A local, read-only web page per durable execution, so tool results can link
 * each row to its execution's live history.
 *
 * WHY A WEB SERVER IN AN MCP SERVER: tool results are text in an agent's chat.
 * The useful thing to put next to an execution ARN there is a link that opens
 * the execution, and a link needs something to answer it. This server is that
 * something. It starts on first use, not at startup, so a session that never
 * returns an ARN never opens a port.
 *
 * EXPOSURE. The page shows execution payloads fetched with the user's AWS
 * credentials, so it must be reachable by the user's own browser and nothing
 * else:
 *   - It listens on 127.0.0.1 only. There is no setting to widen the bind.
 *   - It serves only executions this process linked in a tool result, plus
 *     the child executions those pages link to. Any other ARN gets 404, so a
 *     caller that reaches the port cannot make it fetch an execution of its
 *     choosing, in another account or region.
 *   - It rejects any request whose Host header is not this listener's own
 *     loopback address, so a DNS-rebinding page cannot reach it under a
 *     hostname it controls.
 *   - It rejects requests a browser marks as cross-site (Sec-Fetch-Site), so
 *     another web page cannot make it call AWS by embedding or prefetching a
 *     viewer URL. Opening a link from the agent, a terminal, or the address
 *     bar is "none"; links within the viewer are "same-origin". For browsers
 *     that send no fetch metadata, it also rejects a foreign Origin header,
 *     and any Sec-Fetch-Dest other than a page or its stylesheet.
 *   - It runs at most MAX_CONCURRENT_FETCHES fetches at once, shares one fetch
 *     between requests for the same execution, and caps the history and the
 *     payload text it renders, so requests cannot exhaust the process memory.
 *   - It is read-only: GET and HEAD only (HEAD makes no AWS call), and the
 *     only AWS calls it makes are GetDurableExecution and
 *     GetDurableExecutionHistory. Stopping or starting
 *     executions stays in the VS Code and desktop apps.
 *   - It sends no CORS headers, so no other origin can read its responses.
 * Loopback still means every local user and process on this machine can reach
 * the port, and can read an execution it knows a linked ARN for; on a shared
 * machine, disable the viewer (see README).
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  type ExecutionDetail,
  getExecution,
  isDurableExecutionArn,
  resolveCredentials,
  type LambdaContext,
  type TelemetryConfig,
} from "@aws/durable-execution-sdk-js-telemetry-core";
import {
  executionPath,
  renderErrorPage,
  renderExecutionPage,
  VIEWER_CSS,
} from "./executionPage";

/** The only address the viewer listens on. */
export const VIEWER_HOST = "127.0.0.1";

/** Most executions one process remembers as linked; the oldest are forgotten. */
export const MAX_LINKED_EXECUTIONS = 10_000;
/** Most execution fetches in progress at once; more requests get 503. */
export const MAX_CONCURRENT_FETCHES = 4;
/** History the viewer loads per execution, measured as its JSON length. */
export const MAX_HISTORY_BYTES = 8 * 1024 * 1024;

export interface ExecutionViewerOptions {
  config: TelemetryConfig;
  /** Port to listen on; 0 (the default) picks a free one. */
  port?: number;
  /** Replaces the Lambda client, for tests. */
  lambdaClientFor?: LambdaContext["clientFor"];
  /** Diagnostics sink. stdout is the MCP transport, so this must not be it. */
  log?: (message: string) => void;
}

/**
 * Hands out viewer links, starting the server the first time one is needed.
 * A server that cannot start yields no links rather than failing the tool call
 * that asked for one.
 */
export class ExecutionViewer {
  private server: Server | undefined;
  private starting: Promise<string | undefined> | undefined;
  private origin: string | undefined;
  private allowedHosts = new Set<string>();
  /** ARNs this process linked, oldest first (a Set keeps insertion order). */
  private readonly linked = new Set<string>();
  /**
   * Pages being built, shared between requests for the same execution. The
   * rendered HTML is shared too: one page can be megabytes, and a copy per
   * request would multiply that by the number of concurrent requests.
   */
  private readonly fetching = new Map<string, Promise<Buffer>>();

  constructor(private readonly options: ExecutionViewerOptions) {}

  /**
   * A viewer URL for `arn`, or undefined when it is not an execution ARN.
   * Making the link is what lets the server serve that execution.
   */
  async linkFor(arn: unknown): Promise<string | undefined> {
    if (!isDurableExecutionArn(arn)) return undefined;
    const origin = await this.start();
    if (!origin) return undefined;
    this.allow(arn);
    return `${origin}${executionPath(arn)}`;
  }

  private allow(arn: string): void {
    // Re-adding moves it to the newest end, so a link shown again is the last
    // to be forgotten.
    this.linked.delete(arn);
    this.linked.add(arn);
    while (this.linked.size > MAX_LINKED_EXECUTIONS) {
      const oldest = this.linked.values().next().value;
      if (oldest === undefined) break;
      this.linked.delete(oldest);
    }
  }

  /** One page build per execution at a time; undefined when the cap is reached. */
  private pageOnce(arn: string): Promise<Buffer> | undefined {
    const shared = this.fetching.get(arn);
    if (shared) return shared;
    if (this.fetching.size >= MAX_CONCURRENT_FETCHES) return undefined;
    const { config } = this.options;
    const p = getExecution(
      {
        region: config.region,
        credentials: resolveCredentials(config.awsProfile),
        clientFor: this.options.lambdaClientFor,
      },
      arn,
      { maxHistoryBytes: MAX_HISTORY_BYTES },
    )
      .then((detail) => {
        // Child executions this page links to become servable too.
        for (const child of childExecutionArns(detail)) this.allow(child);
        return Buffer.from(renderExecutionPage(detail), "utf-8");
      })
      .finally(() => this.fetching.delete(arn));
    this.fetching.set(arn, p);
    return p;
  }

  /** Starts the listener once; resolves to its origin, or undefined on failure. */
  start(): Promise<string | undefined> {
    this.starting ??= this.listen(this.options.port ?? 0).then(
      (origin) => origin,
      (err: unknown) => {
        this.log(
          `execution viewer could not start, so results carry no viewer links: ${errorMessage(err)}`,
        );
        return undefined;
      },
    );
    return this.starting;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async listen(port: number): Promise<string> {
    try {
      return await this.listenOn(port);
    } catch (err) {
      // A configured port that is taken (often by another session's viewer)
      // falls back to a free one rather than leaving this session linkless.
      if (port !== 0 && (err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        this.log(
          `execution viewer port ${port} is in use; using a free port instead.`,
        );
        return await this.listenOn(0);
      }
      throw err;
    }
  }

  private listenOn(port: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        this.handle(req, res).catch((err: unknown) => {
          this.log(`execution viewer request failed: ${errorMessage(err)}`);
          if (!res.headersSent) {
            send(res, 500, renderErrorPage("Viewer error", errorMessage(err)));
          } else {
            res.end();
          }
        });
      });
      server.once("error", reject);
      server.listen(port, VIEWER_HOST, () => {
        server.off("error", reject);
        // Do not keep the MCP process alive just for the viewer: the process
        // should end when its stdio transport does.
        server.unref();
        const bound = (server.address() as AddressInfo).port;
        this.server = server;
        this.origin = `http://${VIEWER_HOST}:${bound}`;
        this.allowedHosts = new Set([
          `${VIEWER_HOST}:${bound}`,
          `localhost:${bound}`,
        ]);
        this.log(`execution viewer listening on ${this.origin}`);
        resolve(this.origin);
      });
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    // Browsers send origin-form ("/path"). Anything else is not from one.
    if (!(req.url ?? "").startsWith("/")) {
      send(res, 400, renderErrorPage("Bad request", "Unsupported request."));
      return;
    }
    if (!this.allowedHosts.has((req.headers.host ?? "").toLowerCase())) {
      send(
        res,
        421,
        renderErrorPage("Wrong host", "Unrecognized Host header."),
      );
      return;
    }
    const site = req.headers["sec-fetch-site"];
    const origin = req.headers.origin;
    const dest = req.headers["sec-fetch-dest"];
    if (
      (site !== undefined && site !== "none" && site !== "same-origin") ||
      // Browsers without fetch metadata still send Origin on cross-site
      // requests that carry one.
      (origin !== undefined && origin !== this.origin) ||
      // Only a page, or that page's stylesheet, loads from here: never an
      // image, script, frame, or fetch().
      (dest !== undefined && dest !== "document" && dest !== "style")
    ) {
      send(
        res,
        403,
        renderErrorPage(
          "Blocked",
          "The execution viewer only answers links opened directly, not requests from other sites.",
        ),
      );
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      send(res, 405, renderErrorPage("Method not allowed", "Read-only."));
      return;
    }

    const url = new URL(req.url ?? "/", this.origin);
    if (url.pathname === "/viewer.css") {
      send(res, 200, VIEWER_CSS, "text/css; charset=utf-8");
      return;
    }
    if (url.pathname !== "/execution") {
      send(res, 404, renderErrorPage("Not found", "No such page."));
      return;
    }

    const arn = url.searchParams.get("arn") ?? "";
    if (!isDurableExecutionArn(arn)) {
      send(
        res,
        400,
        renderErrorPage(
          "Not an execution",
          "The link does not name a durable execution ARN.",
        ),
      );
      return;
    }
    if (!this.linked.has(arn)) {
      send(
        res,
        404,
        renderErrorPage(
          "Link not recognized",
          "This server only shows executions it linked in this session. Ask the agent for the execution again to get a fresh link.",
        ),
      );
      return;
    }
    if (req.method === "HEAD") {
      // Answer HEAD from headers alone: it must not cost an AWS call.
      sendHead(res, 200);
      return;
    }
    const page = this.pageOnce(arn);
    if (!page) {
      res.setHeader("Retry-After", "5");
      send(
        res,
        503,
        renderErrorPage(
          "Busy",
          "The viewer is loading other executions. Try again in a few seconds.",
        ),
      );
      return;
    }
    try {
      send(res, 200, await page);
    } catch (err) {
      send(
        res,
        502,
        renderErrorPage("Couldn't load execution", errorMessage(err)),
      );
    }
  }

  private log(message: string): void {
    this.options.log?.(`[durable-telemetry] ${message}`);
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  // No script, no frames, no forms, no outbound loads: styles from this origin
  // only. A meta refresh is a navigation, which this does not restrict.
  "Content-Security-Policy":
    "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/** Every chained-invoke child execution in a detail's operation tree. */
function childExecutionArns(detail: ExecutionDetail): string[] {
  const out: string[] = [];
  const walk = (ops: ExecutionDetail["operations"]) => {
    for (const op of ops) {
      if (isDurableExecutionArn(op.invokedExecutionArn)) {
        out.push(op.invokedExecutionArn);
      }
      walk(op.children ?? []);
    }
  };
  walk(detail.operations);
  return out;
}

function sendHead(res: ServerResponse, status: number): void {
  res.statusCode = status;
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end();
}

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  contentType = "text/html; charset=utf-8",
): void {
  res.statusCode = status;
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(res.req.method === "HEAD" ? undefined : body);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Links in tool results ────────────────────────────────────────────────────

/** Name of the column (and field) that carries each row's viewer link. */
export const VIEWER_LINK_FIELD = "viewerLink";

/** Link text for an execution that has no name. */
export const DEFAULT_LINK_TEXT = "show execution";

const MAX_LINK_TEXT = 80;

/** Lowercased with underscores removed, so execution_name matches executionName. */
function normalizedColumn(name: string): string {
  return name.toLowerCase().replace(/_/g, "");
}

/**
 * The column holding execution ARNs: one named executionArn in any casing
 * (Athena lowercases names, SQL tables use execution_arn) when it holds ARNs,
 * else the first column that does. -1 when no row holds one.
 */
export function executionArnColumnIndex(
  columns: string[],
  rows: string[][],
): number {
  const holdsArns = (i: number) =>
    rows.some((r) => isDurableExecutionArn(r[i]));
  const named = columns.findIndex(
    (c) => normalizedColumn(c) === "executionarn",
  );
  if (named >= 0 && holdsArns(named)) return named;
  return columns.findIndex((_, i) => holdsArns(i));
}

/** The execution-name column (executionName / execution_name / executionname), or -1. */
export function executionNameColumnIndex(columns: string[]): number {
  return columns.findIndex((c) => normalizedColumn(c) === "executionname");
}

/**
 * A Markdown link the agent can show as-is: `[name](url)`, or
 * `[show execution](url)` when the execution has no name. Characters that
 * would end the link text early are escaped, and long names are shortened.
 */
export function markdownLink(name: string | undefined, url: string): string {
  // Control characters and line breaks would end the link text; collapse them.
  let text = collapseControls(name ?? "").trim() || DEFAULT_LINK_TEXT;
  if (text.length > MAX_LINK_TEXT)
    text = `${text.slice(0, MAX_LINK_TEXT - 1)}…`;
  const escaped = text.replace(/[\\[\]<>`]/g, "\\$&");
  return `[${escaped}](${url})`;
}

/** Each run of control characters or line separators becomes one space. */
function collapseControls(s: string): string {
  let out = "";
  let spaced = false;
  for (const c of s) {
    const code = c.codePointAt(0) ?? 0;
    const control =
      code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029;
    if (control || c === " ") {
      if (!spaced) out += " ";
      spaced = true;
    } else {
      out += c;
      spaced = false;
    }
  }
  return out;
}

/** The execution name in a record from `get_execution`, under any column casing. */
export function executionNameFromRecord(
  record: Record<string, string> | undefined,
): string | undefined {
  if (!record) return undefined;
  for (const [key, value] of Object.entries(record)) {
    if (normalizedColumn(key) === "executionname" && value) return value;
  }
  return undefined;
}

/**
 * Appends a `viewerLink` column to a columns/rows result: a Markdown link for
 * each row that holds an execution ARN, an empty string for the rest. Returns
 * the result unchanged when there is no viewer, no ARN column, or the result
 * already has a column of that name.
 */
export async function withViewerLinks<
  T extends { columns: string[]; rows: string[][] },
>(result: T, viewer: ExecutionViewer | undefined): Promise<T> {
  if (!viewer || result.columns.includes(VIEWER_LINK_FIELD)) return result;
  const arnCol = executionArnColumnIndex(result.columns, result.rows);
  if (arnCol < 0) return result;
  const nameCol = executionNameColumnIndex(result.columns);
  const urls = await Promise.all(
    result.rows.map((r) => viewer.linkFor(r[arnCol])),
  );
  if (urls.every((u) => u === undefined)) return result;
  return {
    ...result,
    columns: [...result.columns, VIEWER_LINK_FIELD],
    rows: result.rows.map((r, i) => {
      const url = urls[i];
      return [
        ...r,
        url ? markdownLink(nameCol >= 0 ? r[nameCol] : undefined, url) : "",
      ];
    }),
  };
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface ViewerSettings {
  enabled: boolean;
  port: number;
  warnings: string[];
}

/**
 * Reads the viewer's two environment variables. Never throws: a bad port is a
 * warning and falls back to a free port, matching how the rest of this host
 * treats configuration it cannot use.
 */
export function readViewerSettings(
  env: NodeJS.ProcessEnv,
  names: { disabled: string; port: string },
): ViewerSettings {
  const warnings: string[] = [];
  const enabled = !/^true$/i.test((env[names.disabled] ?? "").trim());
  const raw = (env[names.port] ?? "").trim();
  let port = 0;
  if (raw !== "") {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n <= 65535) {
      port = n;
    } else {
      warnings.push(
        `${names.port}="${raw}" is not a port number (0-65535), so the viewer picks a free port.`,
      );
    }
  }
  return { enabled, port, warnings };
}
