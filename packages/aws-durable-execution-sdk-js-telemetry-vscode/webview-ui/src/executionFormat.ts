/**
 * Pure formatting helpers for the execution viewer pages. No React, so the
 * renderer's node:test suite can cover them directly.
 */
import type { HistoryEvent, OperationNode } from "./types";

/** Execution statuses after which nothing changes (mirrors core). */
export const TERMINAL_STATUSES: readonly string[] = [
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "STOPPED",
];

export function isTerminal(status?: string): boolean {
  return !!status && TERMINAL_STATUSES.includes(status);
}

/** Cloudscape StatusIndicator type for an execution or operation status. */
export function statusType(
  status?: string,
): "success" | "error" | "stopped" | "in-progress" | "pending" | "info" {
  switch (status) {
    case "SUCCEEDED":
      return "success";
    case "FAILED":
    case "TIMED_OUT":
      return "error";
    case "STOPPED":
    case "CANCELLED":
      return "stopped";
    case "RUNNING":
      return "in-progress";
    case "PENDING":
      return "pending";
    default:
      return "info";
  }
}

export function formatDuration(ms?: number): string {
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

/** Local date/time for display, or "—" when absent or unparseable. */
export function formatTimestamp(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Pretty-prints JSON text; returns other text as-is and empty as null. */
export function prettyJson(text?: string): string | null {
  if (text === undefined || text === "") return null;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Depth-first flatten of the operation forest. */
export function flattenOperations(nodes: OperationNode[]): OperationNode[] {
  const out: OperationNode[] = [];
  const walk = (n: OperationNode) => {
    out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  for (const n of nodes) walk(n);
  return out;
}

/**
 * Cheap shape check for "this value is an execution ARN", used only to decide
 * whether to offer an Open link. The host validates the ARN properly before it
 * calls AWS, so this only needs to avoid offering links on unrelated values.
 */
export function looksLikeExecutionArn(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("arn:") &&
    value.includes(":lambda:") &&
    value.includes(":function:") &&
    value.includes("/durable-execution/") &&
    !/\s/.test(value)
  );
}

/** The function name inside an execution ARN, for breadcrumbs. */
export function functionNameFromExecutionArn(arn: string): string | undefined {
  const head = arn.split("/durable-execution/")[0];
  const parts = head.split(":");
  return parts[5] === "function" ? parts[6] || undefined : undefined;
}

/** The function ARN without its `:version`/`:alias` qualifier. */
export function unqualifiedFunctionArn(arn: string): string {
  const parts = arn.split(":");
  return parts.length > 7 ? parts.slice(0, 7).join(":") : arn;
}

/**
 * A fresh execution name derived from a previous one, for "Start new
 * execution": a UUID becomes a new UUID, a trailing number is incremented
 * (keeping zero-padding), anything else gets "-1" appended.
 */
export function nextExecutionName(
  current: string | undefined,
  newUuid: () => string = () => globalThis.crypto.randomUUID(),
): string {
  const name = (current ?? "").trim();
  if (
    !name ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)
  ) {
    return newUuid();
  }
  const digitsAt = trailingDigitsStart(name);
  if (digitsAt < name.length) {
    const digits = name.slice(digitsAt);
    const next = String(Number(digits) + 1).padStart(digits.length, "0");
    return name.slice(0, digitsAt) + next;
  }
  return `${name}-1`;
}

function trailingDigitsStart(s: string): number {
  let i = s.length;
  while (i > 0 && s[i - 1] >= "0" && s[i - 1] <= "9") i--;
  return i;
}

const HISTORY_COLUMNS = [
  "eventId",
  "type",
  "subType",
  "name",
  "id",
  "parentId",
  "timestamp",
] as const;

export function historyToCsv(events: HistoryEvent[]): string {
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = events.map((e) =>
    HISTORY_COLUMNS.map((c) => esc(e[c])).join(","),
  );
  return [HISTORY_COLUMNS.join(","), ...rows].join("\n");
}

/**
 * The column whose values are execution ARNs: the row identifier column when it
 * holds ARNs, else a column named executionArn in any casing (Athena lowercases
 * column names). Undefined when no row has an ARN.
 */
export function executionArnColumn(
  columns: string[],
  rows: string[][],
  idColumn?: string,
): string | undefined {
  const candidates = [
    ...(idColumn ? [idColumn] : []),
    ...columns.filter((c) => c.toLowerCase() === "executionarn"),
  ];
  for (const col of candidates) {
    const i = columns.indexOf(col);
    if (i >= 0 && rows.some((r) => looksLikeExecutionArn(r[i]))) return col;
  }
  return undefined;
}
