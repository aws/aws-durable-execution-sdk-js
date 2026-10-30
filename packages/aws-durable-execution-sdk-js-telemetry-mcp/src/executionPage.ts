/**
 * Server-rendered HTML for the local execution viewer (executionViewer.ts).
 *
 * The page is plain HTML and CSS with no script. Its Refresh link loads the
 * same URL again. Every value from AWS goes through {@link escapeHtml}.
 *
 * The page shows the execution's summary, input, result and error, its
 * operation tree and its invocations. The history is read without execution
 * data, so operations have no result or error.
 */
import {
  type ExecutionDetail,
  type InvocationRow,
  type OperationNode,
  TERMINAL_EXECUTION_STATUSES,
} from "@aws/durable-execution-sdk-js-telemetry-core";

/** Deepest indentation class the stylesheet defines; deeper nesting reuses it. */
const MAX_DEPTH_CLASS = 8;

/** Escapes `value` for HTML text and attribute values. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTime(iso?: string): string {
  // A missing time gives an invalid date, like a malformed one.
  const d = new Date(iso ?? "");
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

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function statusBadge(status: string): string {
  const s = status || "UNKNOWN";
  const cls = /^[A-Z_]+$/.test(s) ? s.toLowerCase() : "unknown";
  return `<span class="status status-${cls}">${escapeHtml(s)}</span>`;
}

function payload(label: string, text?: string): string {
  if (!text) return "";
  return `<details><summary>${escapeHtml(label)}</summary><pre>${escapeHtml(prettyJson(text))}</pre></details>`;
}

function field(label: string, valueHtml: string): string {
  return `<div class="field"><div class="label">${escapeHtml(label)}</div><div class="value">${valueHtml}</div></div>`;
}

function operationDetails(op: OperationNode): string {
  const notes: string[] = [];
  if (op.nextAttemptTime) {
    notes.push(`Next attempt ${formatTime(op.nextAttemptTime)}`);
  }
  if (op.scheduledEndTime) {
    notes.push(`Wait ends ${formatTime(op.scheduledEndTime)}`);
  }
  if (op.callbackId) notes.push(`Callback ${op.callbackId}`);
  if (op.invokedFunction || op.invokedExecutionArn) {
    notes.push(
      `Invoked ${[op.invokedFunction, op.invokedExecutionArn].filter(Boolean).join(" ")}`,
    );
  }
  return notes.map((n) => `<div class="note">${escapeHtml(n)}</div>`).join("");
}

function operationRows(nodes: OperationNode[], depth: number): string {
  return nodes
    .map(
      (op) => `<tr>
<td class="d${Math.min(depth, MAX_DEPTH_CLASS)}">${escapeHtml(op.name || op.id)}</td>
<td>${escapeHtml(op.kind ?? "—")}</td>
<td>${statusBadge(op.status)}</td>
<td>${escapeHtml(formatTime(op.startTime))}</td>
<td>${escapeHtml(formatDuration(op.durationMs))}</td>
<td>${escapeHtml(op.attempt ?? "—")}</td>
<td>${operationDetails(op)}</td>
</tr>
${operationRows(op.children ?? [], depth + 1)}`,
    )
    .join("");
}

function invocationRows(rows: InvocationRow[]): string {
  return rows
    .map(
      (i) => `<tr>
<td><code>${escapeHtml(i.requestId ?? "—")}</code></td>
<td>${escapeHtml(formatTime(i.startTime))}</td>
<td>${escapeHtml(formatDuration(i.durationMs))}</td>
</tr>`,
    )
    .join("\n");
}

function countOperations(nodes: OperationNode[]): number {
  let n = 0;
  for (const op of nodes) n += 1 + countOperations(op.children ?? []);
  return n;
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

/** An error page. */
export function renderErrorPage(title: string, message: string): string {
  return layout(
    title,
    `<h1>${escapeHtml(title)}</h1><p class="error">${escapeHtml(message)}</p>`,
  );
}

/**
 * The execution page. `renderedAt` is shown so a reader can tell a current
 * page from an old one.
 */
export function renderExecutionPage(
  detail: ExecutionDetail,
  renderedAt: Date = new Date(),
): string {
  const title = detail.name || detail.arn.split("/").pop() || "Execution";
  // An empty status is not "running", so the page does not call it running.
  const running =
    detail.status !== "" &&
    !TERMINAL_EXECUTION_STATUSES.includes(detail.status);
  const opCount = countOperations(detail.operations);
  const body = `
<header>
  <h1>${escapeHtml(title)} ${statusBadge(detail.status)}</h1>
  <p class="meta">${running ? "Still running. " : ""}Last updated ${escapeHtml(formatTime(renderedAt.toISOString()))}. <a class="refresh" href="">Refresh</a></p>
</header>
<section class="summary">
${field("Started", escapeHtml(formatTime(detail.startTime)))}
${field("Ended", escapeHtml(formatTime(detail.endTime)))}
${field("Duration", escapeHtml(formatDuration(detail.durationMs)))}
${field("Version", escapeHtml(detail.version ?? "—"))}
${field("Function", `<code>${escapeHtml(detail.functionArn ?? "—")}</code>`)}
${field("Execution ARN", `<code>${escapeHtml(detail.arn)}</code>`)}
</section>
${
  detail.historyError
    ? `<p class="warning">History unavailable, so operations and invocations are not shown: ${escapeHtml(detail.historyError)}</p>`
    : ""
}
<section>
  <h2>Payloads</h2>
  ${payload("Input", detail.input) || `<p class="empty">No input recorded.</p>`}
  ${payload("Result", detail.result)}
  ${payload("Error", detail.error)}
</section>
<section>
  <h2>Operations (${opCount})</h2>
  <p class="note">Step results and errors are not loaded on this page.</p>
  ${
    opCount > 0
      ? `<table><thead><tr><th>Operation</th><th>Kind</th><th>Status</th><th>Started</th><th>Duration</th><th>Attempt</th><th>Details</th></tr></thead>
<tbody>
${operationRows(detail.operations, 0)}
</tbody></table>`
      : `<p class="empty">No operations recorded.</p>`
  }
</section>
<section>
  <h2>Invocations (${detail.invocations.length})</h2>
  ${
    detail.invocations.length > 0
      ? `<table><thead><tr><th>Request ID</th><th>Started</th><th>Duration</th></tr></thead>
<tbody>
${invocationRows(detail.invocations)}
</tbody></table>`
      : `<p class="empty">No completed invocations.</p>`
  }
</section>`;
  return layout(`${title} — durable execution`, body);
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
.note{font-size:12px}
.refresh{margin-left:8px}
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
