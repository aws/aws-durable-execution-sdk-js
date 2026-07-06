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

  // Allowlist top-level keys. The chart is rendered over data the host injects,
  // so the model must not carry its own data/config/width/height — nor a
  // `transform`/`datasets`/`params` (a Vega-Lite transform can even fetch a
  // remote data.url). Rejecting anything outside the allowed set makes the "no
  // data" rule enforced rather than merely requested by the prompt.
  const ALLOWED_TOP_LEVEL = new Set(["mark", "encoding", "title"]);
  const disallowed = Object.keys(spec).filter((k) => !ALLOWED_TOP_LEVEL.has(k));
  if (disallowed.length > 0) {
    throw new Error(
      `The model's chart set disallowed top-level keys: ${disallowed.join(", ")}. ` +
        `Only mark, encoding, and title are allowed.`,
    );
  }

  // Collect every field reference anywhere under encoding (nested included) and
  // validate them. A chart that references no column at all (e.g. an empty
  // encoding, or only datum/value channels) isn't a usable visualization of the
  // result, so reject that too.
  const valid = new Set(validColumns);
  const fields: string[] = [];
  collectFieldRefs((spec as { encoding?: unknown }).encoding, (f) =>
    fields.push(f),
  );
  if (fields.length === 0) {
    throw new Error(
      "The model's chart did not reference any column (empty or field-less encoding).",
    );
  }
  const bad = [...new Set(fields.filter((f) => !valid.has(f)))];
  if (bad.length > 0) {
    throw new Error(
      `The model's chart referenced unknown column(s): ${bad.join(", ")}. ` +
        `Available columns: ${validColumns.join(", ")}.`,
    );
  }
  return spec as Record<string, unknown>;
}

/**
 * Walk an encoding subtree and invoke `onField` for every string-valued `field`
 * property found at any depth (channel definitions, arrays like tooltip, and
 * nested defs such as sort/condition). A `field` whose value isn't a string
 * (e.g. a repeat reference) is left for Vega-Lite to handle.
 */
function collectFieldRefs(
  node: unknown,
  onField: (field: string) => void,
): void {
  if (Array.isArray(node)) {
    for (const item of node) collectFieldRefs(item, onField);
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "field" && typeof value === "string") {
        onField(value);
      } else {
        collectFieldRefs(value, onField);
      }
    }
  }
}
