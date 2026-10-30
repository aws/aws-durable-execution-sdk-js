/**
 * A local, read-only web page per durable execution, so tool results can link
 * each execution to its status, operations and invocations.
 *
 * WHY A WEB SERVER IN AN MCP SERVER. Tool results are text in an agent's chat.
 * The useful thing to put next to an execution there is a link that opens it,
 * and a link needs something to answer it. This server answers it. It starts
 * when a result first needs a link, so a session that never shows an execution
 * opens no port.
 *
 * WHO CALLS IT. The user's own browser, opening a link that this MCP server
 * gave the user's agent. The page shows the user's executions, read with the
 * user's own credentials. Anyone who can call the page could already call
 * Lambda with those credentials. So the checks below catch mistakes and keep
 * the page bounded. They are not a security boundary against the user.
 *
 * LINKS. Each execution ARN that a tool result holds gets a random 128-bit ID
 * the first time it is linked. The link is `/e/<ID>`. The server keeps the ID
 * to ARN map in memory only. An ID that is not in the map gets 404 and no
 * Lambda call. So a caller that reaches the port, without a link this process
 * gave out, can read nothing, and cannot pick the execution to read. The ARN
 * never appears in a URL, so it needs no encoding.
 *
 * LISTENER. It binds 127.0.0.1 only, on a port the operating system picks. It
 * answers GET and HEAD. It rejects a Host header other than its own address,
 * so a page under another hostname cannot reach it through DNS rebinding. Its
 * pages have no script, and a Content-Security-Policy forbids scripts, frames
 * and forms.
 *
 * PAGE SIZE. The page reads the history without execution data, so step
 * results and errors are not loaded. A page is bounded by the operation limit
 * of one execution (30,000), plus the execution's own input, result and error.
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  getExecution,
  isDurableExecutionArn,
  type LambdaContext,
  resolveCredentials,
  type TelemetryConfig,
} from "@aws/durable-execution-sdk-js-telemetry-core";
import { VIEWER_DISABLED_ENV_VAR } from "./envKeys";
import {
  renderErrorPage,
  renderExecutionPage,
  VIEWER_CSS,
} from "./executionPage";

/** The only address the viewer listens on. */
export const VIEWER_HOST = "127.0.0.1";

/**
 * A viewer, or undefined when `DURABLE_TELEMETRY_VIEWER_DISABLED` is `true`
 * in any case. The variable is the user's only way to keep the server from
 * opening a port.
 */
export function viewerFromEnv(
  env: NodeJS.ProcessEnv,
  options: ExecutionViewerOptions,
): ExecutionViewer | undefined {
  return /^true$/i.test((env[VIEWER_DISABLED_ENV_VAR] ?? "").trim())
    ? undefined
    : new ExecutionViewer(options);
}

/** A link's path: `/e/` and a 16-byte ID in base64url, which is 22 characters. */
const LINK_PATH = /^\/e\/([A-Za-z0-9_-]{22})$/;

export interface ExecutionViewerOptions {
  config: TelemetryConfig;
  /** Replaces the Lambda client, for tests. */
  lambdaClientFor?: LambdaContext["clientFor"];
  /** Diagnostics sink. stdout is the MCP transport, so this must not be it. */
  log?: (message: string) => void;
}

/** A running listener. */
interface Started {
  origin: string;
  server: Server;
}

/**
 * Hands out viewer links, starting the server the first time one is needed.
 * A server that cannot start yields no links, rather than failing the tool
 * call that asked for one. The next call that needs a link tries to start it
 * again, so a passing failure (for example, out of file descriptors) does not
 * turn links off for the rest of the session.
 */
export class ExecutionViewer {
  /** The current start attempt. Undefined before the first link, and after a failure or close(). */
  private starting: Promise<Started | undefined> | undefined;
  private readonly arnById = new Map<string, string>();
  private readonly idByArn = new Map<string, string>();

  constructor(private readonly options: ExecutionViewerOptions) {}

  /**
   * A viewer URL for `arn`, or undefined when it is not an execution ARN or
   * the server could not start. The same ARN gets the same URL for the life
   * of the process.
   */
  async linkFor(arn: unknown): Promise<string | undefined> {
    if (!isDurableExecutionArn(arn)) return undefined;
    const origin = (await this.start())?.origin;
    if (!origin) return undefined;
    let id = this.idByArn.get(arn);
    if (!id) {
      id = randomBytes(16).toString("base64url");
      this.idByArn.set(arn, id);
      this.arnById.set(id, arn);
    }
    return `${origin}/e/${id}`;
  }

  /**
   * Starts the listener, once while it runs. Resolves to it, or to undefined
   * when it fails, in which case the next call tries again.
   */
  private start(): Promise<Started | undefined> {
    if (this.starting) return this.starting;
    const attempt: Promise<Started | undefined> = this.listen().catch(
      (err: unknown) => {
        // close() and a newer attempt may have replaced this one. Clearing
        // the newer one would let a third call open a second listener.
        if (this.starting === attempt) this.starting = undefined;
        this.log(
          `execution viewer could not start, so results carry no viewer links: ${errorMessage(err)}`,
        );
        return undefined;
      },
    );
    this.starting = attempt;
    return attempt;
  }

  /**
   * Stops the listener. The server never calls this, because unref() lets the
   * process exit without it. Tests call it. It waits for a start in progress,
   * so that listener is stopped too. A later link starts a new listener, on a
   * new port, that still knows the IDs given out so far.
   */
  async close(): Promise<void> {
    const attempt = this.starting;
    this.starting = undefined;
    const started = await attempt;
    if (!started) return;
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }

  private listen(): Promise<Started> {
    return new Promise((resolve, reject) => {
      // Each listener answers only to its own address.
      const hosts = new Set<string>();
      // handle() catches the one call that can fail, the Lambda read.
      const server = createServer(
        (req, res) => void this.handle(req, res, hosts),
      );
      server.once("error", reject);
      server.listen(0, VIEWER_HOST, () => {
        server.off("error", reject);
        // The MCP process ends when its stdio transport does. The viewer must
        // not keep it alive.
        server.unref();
        const { port } = server.address() as AddressInfo;
        hosts.add(`${VIEWER_HOST}:${port}`);
        hosts.add(`localhost:${port}`);
        const origin = `http://${VIEWER_HOST}:${port}`;
        this.log(`execution viewer listening on ${origin}`);
        resolve({ origin, server });
      });
    });
  }

  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
    hosts: ReadonlySet<string>,
  ) {
    if (!hosts.has((req.headers.host ?? "").toLowerCase())) {
      send(
        res,
        421,
        renderErrorPage("Wrong host", "Unrecognized Host header."),
      );
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      send(res, 405, renderErrorPage("Method not allowed", "Read-only."));
      return;
    }
    const path = (req.url ?? "").split("?")[0];
    if (path === "/viewer.css") {
      send(res, 200, VIEWER_CSS, "text/css; charset=utf-8");
      return;
    }
    const id = LINK_PATH.exec(path)?.[1];
    const arn = id === undefined ? undefined : this.arnById.get(id);
    if (arn === undefined) {
      send(
        res,
        404,
        renderErrorPage(
          "Link not recognized",
          "This link is from another session of the server, or was not given out by it. Ask the agent for the execution again to get a fresh link.",
        ),
      );
      return;
    }
    if (req.method === "HEAD") {
      // HEAD must not cost a Lambda call. Its length is unknown without that
      // call, so it sends no Content-Length rather than a wrong one.
      send(res, 200, undefined);
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
        { includeExecutionData: false },
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
  // No script, no frames, no forms, no outbound loads. Styles from this
  // origin only.
  "Content-Security-Policy":
    "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  // The link ID is in the URL. No-referrer keeps it out of any request the
  // page could make elsewhere.
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

/** Sends `body`, or only the headers when `body` is undefined. */
function send(
  res: ServerResponse,
  status: number,
  body: string | undefined,
  contentType = "text/html; charset=utf-8",
): void {
  res.statusCode = status;
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.setHeader("Content-Type", contentType);
  if (body === undefined) {
    res.end();
    return;
  }
  res.setHeader("Content-Length", Buffer.byteLength(body));
  // Node sends no body for a HEAD response.
  res.end(body);
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
 * The URL is always `http://127.0.0.1:<port>/e/<ID>`, which holds no
 * character that Markdown treats as special.
 */
export function markdownLink(name: string | undefined, url: string): string {
  // Control characters and line breaks would end the link text.
  let text = collapseControls(name ?? "").trim() || DEFAULT_LINK_TEXT;
  // Counted in code points, so the cut never splits a surrogate pair.
  const chars = Array.from(text);
  if (chars.length > MAX_LINK_TEXT) {
    text = `${chars.slice(0, MAX_LINK_TEXT - 1).join("")}…`;
  }
  const escaped = text.replace(/[\\[\]<>`]/g, "\\$&");
  return `[${escaped}](${url})`;
}

/** Each run of control characters or spaces becomes one space. */
function collapseControls(s: string): string {
  let out = "";
  let spaced = false;
  for (const c of s) {
    const code = c.codePointAt(0) ?? 0;
    // C0 and C1 controls, DEL, zero-width characters, line and paragraph
    // separators, bidirectional overrides and isolates, and the BOM.
    const control =
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x200b && code <= 0x200f) ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0xfeff;
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
