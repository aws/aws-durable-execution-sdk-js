/**
 * Parsing and validation for the Vega-Lite spec the model returns for the
 * Visualize page. Kept free of any `vscode`/SDK imports so it can be unit
 * tested directly (see chartSpec.test.ts) — llm.ts owns the model call and
 * delegates the parsing here.
 */

/**
 * Extract the first brace-balanced JSON object from `raw` that actually parses.
 * Unlike a greedy `/\{[\s\S]*\}/`, each candidate stops at its matching close
 * brace (ignoring braces inside string literals), so trailing prose with a
 * brace (e.g. "…hope this helps :}") doesn't make the capture over-read. If a
 * candidate isn't valid JSON — e.g. leading prose like "use {value}: {...}"
 * whose first balanced object is `{value}` — it advances to the next `{` and
 * retries, so a valid spec that follows junk is still found. Returns null if no
 * balanced, parseable object exists.
 */
export function extractJsonObject(raw: string): string | null {
  for (
    let start = raw.indexOf("{");
    start !== -1;
    start = raw.indexOf("{", start + 1)
  ) {
    const candidate = balancedObjectAt(raw, start);
    if (candidate !== null) {
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        // Balanced but not valid JSON (e.g. `{value}`) — try the next brace.
      }
    }
  }
  return null;
}

/** The brace-balanced substring starting at `start` (a `{`), or null if never closed. */
function balancedObjectAt(raw: string, start: number): string | null {
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
 * Throws (with a human-readable message) if there is no parseable JSON object,
 * it's missing mark/encoding, sets a disallowed top-level key, or any encoding
 * channel references a `field` that isn't one of `validColumns` — a
 * hallucinated or misspelled field is otherwise valid JSON and would render a
 * blank/broken chart with no error, the exact failure this feature prevents.
 */
export function parseChartSpec(
  raw: string,
  validColumns: string[],
): Record<string, unknown> {
  const json = extractJsonObject(raw);
  if (!json) {
    throw new Error("The model did not return a valid chart specification.");
  }
  const spec: unknown = JSON.parse(json); // extractJsonObject guarantees this parses
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
      `The model's chart spec included disallowed top-level keys: ${disallowed.join(", ")}. ` +
        `Only mark, encoding, and title are allowed.`,
    );
  }

  // Validate the mark itself, not just its presence: Vega-Lite allows an object
  // mark like {"type":"image","url":"…"} that would pull an external resource,
  // so restrict it to a known rendering mark (given as a string or {type: …}).
  // (The webview CSP also blocks that, but the validator shouldn't rely solely
  // on it to be "the single source of usable chart".)
  const mark = (spec as { mark?: unknown }).mark;
  const markType =
    typeof mark === "string"
      ? mark
      : mark && typeof mark === "object"
        ? (mark as { type?: unknown }).type
        : undefined;
  if (typeof markType !== "string" || !ALLOWED_MARKS.has(markType)) {
    throw new Error(
      `The model's chart used an unsupported mark (${JSON.stringify(mark)}). ` +
        `Allowed marks: ${[...ALLOWED_MARKS].join(", ")}.`,
    );
  }

  // If a title is present, it must be a string or a plain object (Vega-Lite
  // TitleParams). No external-resource vector, but validate the shape so the
  // allowlist genuinely covers every top-level key it permits.
  if ("title" in spec) {
    const title = (spec as { title?: unknown }).title;
    const okTitle =
      typeof title === "string" ||
      (title != null && typeof title === "object" && !Array.isArray(title));
    if (!okTitle) {
      throw new Error("The model's chart had a malformed title.");
    }
  }

  // The encoding must be a plain object (map of channels); a string/array/null
  // would otherwise fall through to the "no columns" error with a misleading
  // message.
  const encoding = (spec as { encoding?: unknown }).encoding;
  if (
    encoding == null ||
    typeof encoding !== "object" ||
    Array.isArray(encoding)
  ) {
    throw new Error("The model's chart had a malformed encoding.");
  }

  // Reject dynamic expressions anywhere in the spec (defense-in-depth beyond
  // Vega's sandboxed evaluator): the chart should be static over the fetched
  // rows. Scans the WHOLE spec — including an object mark/title, not just
  // encoding — so the guard matches its "static chart" intent.
  const dynamicKeys = new Set<string>();
  collectDynamicKeys(spec, (k) => dynamicKeys.add(k));
  if (dynamicKeys.size > 0) {
    throw new Error(
      `The model's chart used disallowed dynamic expression(s) (${[...dynamicKeys].join(", ")}).`,
    );
  }

  // Collect every field reference anywhere under encoding (nested included) and
  // validate them. A chart that references no column at all (e.g. an empty
  // encoding, or only datum/value channels) isn't a usable visualization of the
  // result, so reject that too.
  const valid = new Set(validColumns);
  const fields: string[] = [];
  collectFieldRefs(encoding, (f) => fields.push(f));
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

// Known Vega-Lite rendering marks the Visualize page can produce. Excludes
// "image" and "geoshape", which reference external URLs.
const ALLOWED_MARKS = new Set([
  "bar",
  "line",
  "area",
  "point",
  "circle",
  "square",
  "tick",
  "rect",
  "arc",
  "rule",
  "text",
  "trail",
  "boxplot",
  "errorbar",
  "errorband",
]);

/**
 * Walk an encoding subtree and invoke `onField` for every string-valued `field`
 * property found at any depth (channel definitions, arrays like tooltip, and
 * nested defs such as sort/condition), and `onDisallowedKey` for any `expr`/
 * `signal` key. A `field` whose value isn't a string (e.g. a repeat reference)
 * is left for Vega-Lite to handle.
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

/** Walk any node and invoke `onKey` for every `expr`/`signal` key (dynamic bindings). */
function collectDynamicKeys(node: unknown, onKey: (key: string) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) collectDynamicKeys(item, onKey);
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "expr" || key === "signal") onKey(key);
      collectDynamicKeys(value, onKey);
    }
  }
}
