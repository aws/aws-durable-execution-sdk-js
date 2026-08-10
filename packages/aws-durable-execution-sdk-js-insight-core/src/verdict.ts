/**
 * Pure, dependency-free helpers for the advanced (agentic) mode's
 * result-verification step. Kept separate from llm.ts so they carry no
 * `vscode` or AWS SDK imports and can be unit-tested directly.
 */

import { extractJsonObject } from "./jsonExtract";

/**
 * The model's verdict on whether a query's results actually answer the
 * user's question. Used by the verify/refine provider path (Copilot/local) to
 * decide whether to accept the results or refine the query. (The Bedrock path
 * drives that decision through its own multi-step tool loop instead.)
 */
export interface ResultVerdict {
  satisfied: boolean;
  /** One-sentence rationale for the verdict. */
  reason: string;
  /**
   * When not satisfied: a concrete suggestion for how to change the query to
   * better answer the question (fed back into the next generation attempt).
   */
  suggestion?: string;
}

/**
 * Parse a verdict out of a free-text (Copilot/local) model response. Falls
 * back to "satisfied" if no parseable JSON is found, so a flaky judge can
 * never wedge the loop or hide results.
 */
export function parseVerdict(text: string): ResultVerdict {
  const jsonText = extractJsonObject(text, '"satisfied"');
  if (jsonText === undefined) {
    return {
      satisfied: true,
      reason: "Could not parse a verdict; accepting the results as-is.",
    };
  }
  try {
    const parsed = JSON.parse(jsonText) as {
      satisfied?: unknown;
      reason?: unknown;
      suggestion?: unknown;
    };
    return {
      satisfied: parsed.satisfied === true,
      reason:
        typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim()
          : "No reason provided.",
      suggestion:
        typeof parsed.suggestion === "string" && parsed.suggestion.trim()
          ? parsed.suggestion.trim()
          : undefined,
    };
  } catch {
    return {
      satisfied: true,
      reason: "Could not parse a verdict; accepting the results as-is.",
    };
  }
}

/** Build the instruction handed to the judge, shared across providers. */
export function buildVerifyInstruction(opts: {
  question: string;
  query: string;
  columns: string[];
  rowCount: number;
  sampleRows: string[][];
}): string {
  const sample = opts.sampleRows
    .map((r) => opts.columns.map((c, i) => `${c}=${r[i] ?? ""}`).join(", "))
    .join("\n");
  return [
    "You are checking whether a query's results answer a user's question.",
    "",
    `User question: ${opts.question}`,
    "",
    `Query that was run:\n${opts.query}`,
    "",
    `Result columns: ${opts.columns.join(", ") || "(none)"}`,
    `Total rows returned: ${opts.rowCount}`,
    opts.rowCount > 0
      ? `Sample rows (up to ${opts.sampleRows.length}):\n${sample}`
      : "The query returned no rows.",
    "",
    "Decide if these results genuinely answer the question. Note: an empty",
    "result set can be the correct answer (e.g. 'no failed executions') — only",
    "judge it unsatisfied if the query looks like it targets the wrong field,",
    "shape, or filter. If not satisfied, suggest a concrete query change.",
  ].join("\n");
}

/**
 * Build the instruction for the post-processing / "analyze" step (advanced
 * mode): answer the question directly from the rows a query returned, rather
 * than expressing everything in the query language. Bounded in both rows and
 * per-cell length so a large result can't blow the model's context window.
 */
export function buildAnalysisPrompt(opts: {
  question: string;
  goal?: string;
  columns: string[];
  rows: string[][];
  maxRows?: number;
  maxCellChars?: number;
}): string {
  const maxRows = opts.maxRows ?? 50;
  const maxCellChars = opts.maxCellChars ?? 500;
  const shown = opts.rows.slice(0, maxRows);
  const truncatedRows = opts.rows.length > maxRows;
  const body = shown
    .map((r) =>
      opts.columns
        .map((c, i) => {
          let v = r[i] ?? "";
          if (v.length > maxCellChars) {
            v = `${v.slice(0, maxCellChars)}…(truncated)`;
          }
          return `${c}=${v}`;
        })
        .join(" | "),
    )
    .join("\n");
  const lines: string[] = [
    "Answer the user's question using ONLY the data in the rows below. Do not",
    "invent values that are not present. These rows are ALSO shown to the user",
    "as a table, so do NOT repeat them row-by-row — give a concise",
    "natural-language summary or the specific value/insight the question asks",
    "for (counts, ranges, notable patterns, the computed result). For a plain",
    "'show/list records' request, one or two sentences (how many, the time span,",
    "anything notable) is enough — the table shows the detail.",
    "",
    `Question: ${opts.question}`,
  ];
  if (opts.goal) lines.push(`What to extract: ${opts.goal}`);
  lines.push(
    "",
    `Columns: ${opts.columns.join(", ") || "(none)"}`,
    `Rows (${shown.length}${truncatedRows ? ` of ${opts.rows.length}, truncated` : ""}):`,
    body || "(no rows)",
  );
  return lines.join("\n");
}
