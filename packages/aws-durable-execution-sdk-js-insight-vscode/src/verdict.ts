/**
 * Pure, dependency-free helpers for the advanced (agentic) mode's
 * result-verification step. Kept separate from llm.ts so they carry no
 * `vscode` or AWS SDK imports and can be unit-tested directly.
 */

/**
 * The model's verdict on whether a query's results actually answer the
 * user's question. Used only in "advanced" (agentic) mode — basic mode never
 * calls the judge and its behavior is unchanged.
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
  const jsonMatch = text.match(/\{[\s\S]*"satisfied"[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      satisfied: true,
      reason: "Could not parse a verdict; accepting the results as-is.",
    };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
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
