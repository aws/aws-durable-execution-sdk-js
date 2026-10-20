// Pure parsing helpers for the "local-server" LLM provider's text responses.
// Kept dependency-free (no vscode / SDK imports) so the JSON-extraction and
// validation logic is unit-testable without mocks. Consumed by llm.ts.

/**
 * Extract the first complete, balanced JSON object from arbitrary model text.
 * Unlike a greedy `/\{[\s\S]*\}/`, this walks braces (ignoring those inside
 * string literals, and respecting backslash escapes) so prose or trailing
 * braces around the JSON don't cause it to capture the wrong span. Returns the
 * object substring, or null if no balanced object is found.
 */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** The query fields a local-server response is expected to carry. */
export interface ParsedLocalServerQuery {
  query: string;
  explanation: string;
  /** Present only if the model supplied one; caller applies its own default. */
  timeRangeMs?: number;
  suggestedCharts?: string[];
}

/**
 * Turn a raw local-server completion into a validated query object. Throws a
 * user-friendly Error when the response contains no JSON object, isn't valid
 * JSON, or has no non-empty `query`. `timeRangeMs` is passed through only when
 * present so the caller can apply its own default.
 */
export function parseLocalServerQueryResponse(
  response: string,
): ParsedLocalServerQuery {
  const jsonText = extractFirstJsonObject(response);
  if (!jsonText) {
    throw new Error(
      "The local model server did not return a valid query. Try rephrasing your question.",
    );
  }
  let parsed: {
    query?: string;
    explanation?: string;
    timeRangeMs?: number;
    suggestedCharts?: string[];
  };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(
      "The local model server did not return valid JSON. Try rephrasing your question.",
    );
  }
  if (!parsed.query || !parsed.query.trim()) {
    throw new Error(
      "The local model server returned an empty query. Try rephrasing your question.",
    );
  }
  return {
    query: parsed.query.trim(),
    explanation: (parsed.explanation ?? "").trim(),
    timeRangeMs: parsed.timeRangeMs,
    suggestedCharts: parsed.suggestedCharts,
  };
}
