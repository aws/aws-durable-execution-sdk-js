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
 *   - It rejects any request whose Host header is not this listener's own
 *     loopback address, so a DNS-rebinding page cannot reach it under a
 *     hostname it controls.
 *   - It rejects requests a browser marks as cross-site (Sec-Fetch-Site), so
 *     another web page cannot make it call AWS by embedding or prefetching a
 *     viewer URL. Opening a link from the agent, a terminal, or the address
 *     bar is "none"; links within the viewer are "same-origin".
 *   - It is read-only: GET and HEAD only, and the only AWS calls it makes are
 *     GetDurableExecution and GetDurableExecutionHistory. Stopping or starting
 *     executions stays in the VS Code and desktop apps.
 *   - It sends no CORS headers, so no other origin can read its responses.
 * Loopback still means every local user and process on this machine can reach
 * the port; on a shared machine, disable the viewer (see README).
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
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

  constructor(private readonly options: ExecutionViewerOptions) {}

  /** A viewer URL for `arn`, or undefined when it is not an execution ARN. */
  async linkFor(arn: unknown): Promise<string | undefined> {
    if (!isDurableExecutionArn(arn)) return undefined;
    const origin = await this.start();
    return origin ? `${origin}${executionPath(arn)}` : undefined;
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
    if (!this.allowedHosts.has((req.headers.host ?? "").toLowerCase())) {
      send(
        res,
        421,
        renderErrorPage("Wrong host", "Unrecognized Host header."),
      );
      return;
    }
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "none" && site !== "same-origin") {
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
    const { config } = this.options;
    try {
      const detail = await getExecution(
        {
          region: config.region,
          credentials: resolveCredentials(config.awsProfile),
          clientFor: this.options.lambdaClientFor,
        },
        arn,
      );
      send(res, 200, renderExecutionPage(detail));
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
};

function send(
  res: ServerResponse,
  status: number,
  body: string,
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
  let text = (name ?? "").trim() || DEFAULT_LINK_TEXT;
  if (text.length > MAX_LINK_TEXT)
    text = `${text.slice(0, MAX_LINK_TEXT - 1)}…`;
  const escaped = text.replace(/[\\[\]]/g, "\\$&");
  return `[${escaped}](${url})`;
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
