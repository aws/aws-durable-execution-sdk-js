/**
 * Parsing and validation for the Vega-Lite spec the model returns for the
 * Visualize page. Kept free of any `vscode`/SDK imports so it can be unit
 * tested directly (see chartSpec.test.ts) — llm.ts owns the model call and
 * delegates the parsing here.
 */

/**
 * Extract the first brace-balanced JSON object from `raw`. Unlike a greedy
 * `/\{[\s\S]*\}/`, this stops at the matching close brace, so trailing prose
 * that happens to contain a brace (e.g. "…hope this helps :}") doesn't make the
 * capture over-read. Brace counting ignores braces inside string literals.
 * Returns null if there is no balanced object.
 */
export function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
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
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null; // never balanced
}

/**
 * Parse the model's response into a Vega-Lite spec fragment and validate it.
 * Throws (with a human-readable message) if there is no JSON object, it doesn't
 * parse, it's missing mark/encoding, or any encoding channel references a
 * `field` that isn't one of `validColumns` — a hallucinated or misspelled
 * field is otherwise valid JSON and would render a blank/broken chart with no
 * error, the exact failure this feature exists to prevent.
 */
export function parseChartSpec(
  raw: string,
  validColumns: string[],
): Record<string, unknown> {
  const json = extractJsonObject(raw);
  if (!json) {
    throw new Error("The model did not return a chart specification.");
  }
  let spec: unknown;
  try {
    spec = JSON.parse(json);
  } catch {
    throw new Error("The model returned an invalid chart specification.");
  }
  if (
    spec == null ||
    typeof spec !== "object" ||
    !("mark" in spec) ||
    !("encoding" in spec)
  ) {
    throw new Error(
      "The model's chart specification was missing mark/encoding.",
    );
  }

  const valid = new Set(validColumns);
  const bad = new Set<string>();
  const encoding = (spec as { encoding?: unknown }).encoding;
  if (encoding && typeof encoding === "object") {
    for (const channel of Object.values(encoding as Record<string, unknown>)) {
      // A channel is usually one definition object, but some (tooltip, detail)
      // can be an array of them. Channels without a `field` (an aggregate
      // "count", a datum/value) are legitimate and simply have nothing to check.
      for (const def of Array.isArray(channel) ? channel : [channel]) {
        const field = (def as { field?: unknown } | null)?.field;
        if (typeof field === "string" && !valid.has(field)) {
          bad.add(field);
        }
      }
    }
  }
  if (bad.size > 0) {
    throw new Error(
      `The model's chart referenced unknown column(s): ${[...bad].join(", ")}. ` +
        `Available columns: ${validColumns.join(", ")}.`,
    );
  }
  return spec as Record<string, unknown>;
}
