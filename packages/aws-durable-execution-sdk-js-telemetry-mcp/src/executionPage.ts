/**
 * Server-rendered HTML for the local execution viewer (executionViewer.ts).
 *
 * The page is plain HTML and CSS with no script: everything interactive is a
 * link or a `<details>` disclosure. The page never reloads itself; its Refresh
 * link loads it again when the reader wants current data.
 * With no script there is nothing for injected content to execute, and every
 * value from AWS still goes through {@link escapeHtml}.
 */
import type {
  ExecutionDetail,
  InvocationRow,
  OperationNode,
} from "@aws/durable-execution-sdk-js-telemetry-core";
import { TERMINAL_EXECUTION_STATUSES } from "@aws/durable-execution-sdk-js-telemetry-core";

/** Seconds a client is told to wait before retrying a Busy response. */
export const REFRESH_SECONDS = 5;

/** Query parameter that makes the server skip its page cache. */
export const REFRESH_PARAM = "refresh";

/** The Refresh link's target: this page again, read fresh from Lambda. */
export function refreshHref(arn: string): string {
  return `${relativeExecutionHref(arn)}&${REFRESH_PARAM}=1`;
}

/** A refresh icon drawn inline, so the page loads nothing else. */
const REFRESH_ICON =
  '<svg class="icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12.2 1.6v3.1H9.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function refreshLink(arn: string, label: string): string {
  return `<a class="refresh" href="${escapeHtml(refreshHref(arn), Number.POSITIVE_INFINITY)}" title="${escapeHtml(label)}">${REFRESH_ICON}<span>${escapeHtml(label)}</span></a>`;
}

/** Deepest indentation class the stylesheet defines; deeper nesting reuses it. */
const MAX_DEPTH_CLASS = 8;

/** Longest single field (name, kind, ID, …) the page shows; the rest is cut. */
export const MAX_FIELD_CHARS = 256;
/** Longest ARN or error message the page shows. */
export const MAX_LONG_FIELD_CHARS = 2048;
/** Most operation rows the page shows, across the whole tree. */
export const MAX_OPERATION_ROWS = 2000;

/**
 * Escapes `value` for HTML, first cutting it to `max` characters. Every field
 * is bounded, so execution data cannot make a page arbitrarily large.
 */
export function escapeHtml(value: unknown, max = MAX_FIELD_CHARS): string {
  let text = String(value ?? "");
  if (text.length > max) text = `${text.slice(0, max - 1)}…`;
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The viewer's own link to an execution (relative, so it stays same-origin). */
export function executionPath(arn: string): string {
  // encodeURIComponent leaves ( ) ! * ' ~ as they are. Encode them too, so a
  // URL placed in a Markdown link can never end the link early.
  const arnParam = encodeURIComponent(arn).replace(
    /[()!*'~]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `/execution?arn=${arnParam}`;
}

/**
 * A link from one execution page to another, relative to the current page.
 * Pages are served at "/s/<token>/execution", so "execution?arn=…" resolves
 * under the same token without this module knowing it.
 */
export function relativeExecutionHref(arn: string): string {
  return executionPath(arn).slice(1);
}

/** Most characters shown for one payload; the rest is cut with a note. */
export const MAX_PAYLOAD_CHARS = 64 * 1024;
/** Most payload characters shown on one page; later payloads are omitted. */
export const MAX_PAGE_PAYLOAD_CHARS = 2 * 1024 * 1024;
/** Most history rows shown in the history table. */
export const MAX_HISTORY_ROWS = 2000;

/** What is still available on the page being rendered. */
interface PayloadBudget {
  /** Payload characters. */
  remaining: number;
  /** Operation rows. */
  rows: number;
}

function formatTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

function formatDuration(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function prettyJson(text?: string): string | undefined {
  if (text === undefined || text === "") return undefined;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function statusBadge(status?: string): string {
  const s = status || "UNKNOWN";
  const cls = /^[A-Z_]+$/.test(s) ? s.toLowerCase() : "unknown";
  return `<span class="status status-${cls}">${escapeHtml(s)}</span>`;
}

function codeBlock(
  budget: PayloadBudget,
  label: string,
  text?: string,
): string {
  let pretty = prettyJson(text);
  if (pretty === undefined) return "";
  if (budget.remaining <= 0) {
    return `<details><summary>${escapeHtml(label)}</summary><p class="note">Not shown: this page already shows as much payload as the viewer allows.</p></details>`;
  }
  const limit = Math.min(MAX_PAYLOAD_CHARS, budget.remaining);
  if (pretty.length > limit) {
    const total = pretty.length;
    pretty = `${pretty.slice(0, limit)}\n… shortened in the viewer: ${total.toLocaleString("en-US")} characters in full`;
  }
  budget.remaining -= Math.min(limit, pretty.length);
  return `<details><summary>${escapeHtml(label)}</summary><pre>${escapeHtml(pretty, Number.POSITIVE_INFINITY)}</pre></details>`;
}

function field(label: string, valueHtml: string): string {
  return `<div class="field"><div class="label">${escapeHtml(label)}</div><div class="value">${valueHtml}</div></div>`;
}

function operationRows(
  nodes: OperationNode[],
  depth: number,
  budget: PayloadBudget,
): string {
  const out: string[] = [];
  for (const op of nodes) {
    if (budget.rows <= 0) break;
    budget.rows--;
    {
      const name = escapeHtml(op.name || op.id);
      const extra = [
        op.nextAttemptTime
          ? `<div class="note">Next attempt ${escapeHtml(formatTime(op.nextAttemptTime))}</div>`
          : "",
        op.scheduledEndTime
          ? `<div class="note">Wait ends ${escapeHtml(formatTime(op.scheduledEndTime))}</div>`
          : "",
        op.callbackId
          ? `<div class="note">Callback <code>${escapeHtml(op.callbackId, MAX_LONG_FIELD_CHARS)}</code></div>`
          : "",
        op.invokedExecutionArn
          ? `<div class="note">Invoked <a href="${escapeHtml(relativeExecutionHref(op.invokedExecutionArn), Number.POSITIVE_INFINITY)}">${escapeHtml(op.invokedFunction || "execution")}</a></div>`
          : op.invokedFunction
            ? `<div class="note">Invoked ${escapeHtml(op.invokedFunction)}</div>`
            : "",
        op.payloadTruncated
          ? `<div class="note">Payload truncated by Lambda.</div>`
          : "",
        codeBlock(budget, "Result", op.result),
        codeBlock(budget, "Error", op.error),
      ].join("");
      const row = `<tr>
<td class="d${Math.min(depth, MAX_DEPTH_CLASS)}">${name}</td>
<td>${escapeHtml(op.kind ?? "—")}</td>
<td>${statusBadge(op.status)}</td>
<td>${escapeHtml(formatTime(op.startTime))}</td>
<td>${escapeHtml(formatDuration(op.durationMs))}</td>
<td>${escapeHtml(op.attempt ?? "—")}</td>
<td>${extra}</td>
</tr>`;
      out.push(row, operationRows(op.children ?? [], depth + 1, budget));
    }
  }
  return out.join("\n");
}

function invocationRows(rows: InvocationRow[], budget: PayloadBudget): string {
  return rows
    .map(
      (i) => `<tr>
<td><code>${escapeHtml(i.requestId ?? "—")}</code></td>
<td>${escapeHtml(formatTime(i.startTime))}</td>
<td>${escapeHtml(formatDuration(i.durationMs))}</td>
<td>${codeBlock(budget, "Error", i.error)}</td>
</tr>`,
    )
    .join("\n");
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/viewer.css">
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

/**
 * An error page. With `retryArn`, it offers a "Try again" link to that
 * execution's page, for errors that pass, such as Busy.
 */
export function renderErrorPage(
  title: string,
  message: string,
  retryArn?: string,
): string {
  return layout(
    title,
    `<h1>${escapeHtml(title)}</h1><p class="error">${escapeHtml(message, MAX_LONG_FIELD_CHARS)}</p>${
      retryArn ? `<p>${refreshLink(retryArn, "Try again")}</p>` : ""
    }`,
  );
}

/**
 * The execution page. `renderedAt` is shown so a reader can tell a current
 * page from an old one. `requestedArn` is the ARN in the page's own URL. The
 * Refresh link uses it, because the server serves only ARNs it linked, and
 * the ARN Lambda returns in `detail` may be spelled differently.
 */
export function renderExecutionPage(
  detail: ExecutionDetail,
  renderedAt: Date = new Date(),
  requestedArn: string = detail.arn,
): string {
  // Execution-level payloads first, so input and result are shown even when
  // operations use up the page's budget.
  const budget: PayloadBudget = {
    remaining: MAX_PAGE_PAYLOAD_CHARS,
    rows: MAX_OPERATION_ROWS,
  };
  const payloads = `${codeBlock(budget, "Input", detail.input) || `<p class="empty">No input recorded.</p>`}
  ${codeBlock(budget, "Result", detail.result)}
  ${codeBlock(budget, "Error", detail.error)}`;
  // An empty status is not "running", so the page does not call it running.
  const live =
    detail.status !== "" &&
    !TERMINAL_EXECUTION_STATUSES.includes(detail.status);
  const title = detail.name || detail.arn.split("/").pop() || "Execution";
  const opCount = countOperations(detail.operations);

  const notices = [
    detail.historyError
      ? detail.history.length > 0
        ? `<p class="warning">History is incomplete: reading it failed after ${detail.history.length} events, so later operations are missing and some shown here may look unfinished: ${escapeHtml(detail.historyError, MAX_LONG_FIELD_CHARS)}</p>`
        : `<p class="warning">History unavailable, so operations are not shown: ${escapeHtml(detail.historyError, MAX_LONG_FIELD_CHARS)}</p>`
      : "",
    detail.historyTruncated
      ? `<p class="warning">This execution has more history than the viewer loads (${detail.history.length} events shown). Operations started after that point are missing, and some shown here may look unfinished because their later events were not loaded.</p>`
      : "",
  ].join("");

  const body = `
<header>
  <h1>${escapeHtml(title)} ${statusBadge(detail.status)}</h1>
  <p class="meta">${
    live
      ? `Still running. Last updated ${escapeHtml(formatTime(renderedAt.toISOString()))}; refresh for the latest.`
      : `Last updated ${escapeHtml(formatTime(renderedAt.toISOString()))}.`
  } ${refreshLink(requestedArn, "Refresh")}</p>
</header>
<section class="summary">
${field("Started", escapeHtml(formatTime(detail.startTime)))}
${field("Ended", escapeHtml(formatTime(detail.endTime)))}
${field("Duration", escapeHtml(formatDuration(detail.durationMs)))}
${field("Invocations", escapeHtml(detail.invocations.length))}
${field("Version", escapeHtml(detail.version ?? "—"))}
${field("Function", `<code>${escapeHtml(detail.functionArn ?? "—", MAX_LONG_FIELD_CHARS)}</code>`)}
${field("Execution ARN", `<code>${escapeHtml(detail.arn, MAX_LONG_FIELD_CHARS)}</code>`)}
</section>
${notices}
<section>
  <h2>Operations (${opCount})</h2>
  ${
    opCount > MAX_OPERATION_ROWS
      ? `<p class="note">Showing the first ${MAX_OPERATION_ROWS.toLocaleString("en-US")} operations.</p>`
      : ""
  }
  ${
    opCount > 0
      ? `<table><thead><tr><th>Operation</th><th>Kind</th><th>Status</th><th>Started</th><th>Duration</th><th>Attempt</th><th>Details</th></tr></thead>
<tbody>
${operationRows(detail.operations, 0, budget)}
</tbody></table>`
      : `<p class="empty">No operations recorded.</p>`
  }
</section>
<section>
  <h2>Payloads</h2>
  ${payloads}
</section>
<section>
  <h2>Invocations (${detail.invocations.length})</h2>
  ${
    detail.invocations.length > 0
      ? `<table><thead><tr><th>Request ID</th><th>Started</th><th>Duration</th><th>Error</th></tr></thead>
<tbody>
${invocationRows(detail.invocations, budget)}
</tbody></table>`
      : `<p class="empty">No completed invocations.</p>`
  }
</section>
<section>
  <details>
    <summary>History (${detail.history.length} events)</summary>
    ${
      detail.history.length > MAX_HISTORY_ROWS
        ? `<p class="note">Showing the first ${MAX_HISTORY_ROWS.toLocaleString("en-US")} events.</p>`
        : ""
    }
    <table><thead><tr><th>#</th><th>Type</th><th>Subtype</th><th>Operation</th><th>Time</th></tr></thead>
    <tbody>
${detail.history
  .slice(0, MAX_HISTORY_ROWS)
  .map(
    (e) =>
      `<tr><td>${escapeHtml(e.eventId ?? "—")}</td><td>${escapeHtml(e.type ?? "—")}</td><td>${escapeHtml(e.subType || "—")}</td><td>${escapeHtml(e.name || "—")}</td><td>${escapeHtml(formatTime(e.timestamp))}</td></tr>`,
  )
  .join("\n")}
    </tbody></table>
  </details>
</section>`;
  return layout(`${title} — durable execution`, body);
}

function countOperations(nodes: OperationNode[]): number {
  let n = 0;
  for (const op of nodes) n += 1 + countOperations(op.children ?? []);
  return n;
}

const DEPTH_RULES = Array.from(
  { length: MAX_DEPTH_CLASS + 1 },
  (_, d) => `td.d${d}{padding-left:${0.5 + d * 1.25}rem}`,
).join("\n");

export const VIEWER_CSS = `
:root{color-scheme:light dark;--bg:#0f1b2a;--panel:#192534;--text:#e9ebed;--muted:#a4a9b0;--border:#414d5c;--link:#42b4ff}
@media (prefers-color-scheme: light){:root{--bg:#fff;--panel:#f4f4f4;--text:#16191f;--muted:#5f6b7a;--border:#d1d5db;--link:#0972d3}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px}
h1{font-size:22px;margin:0 0 4px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
h2{font-size:16px;margin:28px 0 8px}
a{color:var(--link)}
code,pre{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
code{word-break:break-all}
pre{background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:10px;overflow:auto;max-height:420px;white-space:pre-wrap;word-break:break-word}
.meta,.empty,.note{color:var(--muted)}
.refresh{display:inline-flex;align-items:center;gap:4px;margin-left:8px;padding:2px 10px;border:1px solid var(--border);border-radius:12px;text-decoration:none;color:var(--link);background:var(--panel);font-size:13px}
.refresh:hover{border-color:var(--link)}
.icon{flex:none}
.note{font-size:12px}
.summary{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px 24px;background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px;margin-top:16px}
.label{font-weight:700}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;vertical-align:top;padding:6px 8px;border-bottom:1px solid var(--border)}
th{color:var(--muted);font-weight:600}
details{margin:6px 0}
summary{cursor:pointer;color:var(--link)}
.status{font-size:12px;font-weight:700;padding:2px 8px;border-radius:10px;border:1px solid currentColor;white-space:nowrap}
.status-succeeded{color:#29ad32}
.status-failed,.status-timed_out{color:#ff5d64}
.status-running,.status-pending{color:#42b4ff}
.status-stopped,.status-cancelled,.status-incomplete,.status-unknown{color:var(--muted)}
.warning{border-left:4px solid #f89256;padding:8px 12px;background:var(--panel)}
.error{border-left:4px solid #ff5d64;padding:8px 12px;background:var(--panel)}
${DEPTH_RULES}
`;
