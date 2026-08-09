/**
 * Validates that a SQL/PartiQL query is read-only (SELECT only).
 * Rejects any statement that could mutate data.
 *
 * This is a defense-in-depth measure since queries are LLM-generated
 * and could be hallucinated or prompt-injected. Customers should also
 * configure their DB credentials with read-only permissions.
 */

/**
 * Data-modifying / DDL / privilege keywords that must not appear as a
 * statement ANYWHERE in the query — not just at its start. Scanning only the
 * start (as an earlier version did) let a PostgreSQL data-modifying CTE slip
 * through, because the write is not the first token:
 *
 *   WITH x AS (SELECT 1) DELETE FROM t                    -- write after the CTE
 *   WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d  -- write inside the CTE
 *
 * Both start with WITH and contain no second statement, so start-anchored and
 * multi-statement checks miss them. We instead scan the whole query (with
 * string literals and comments blanked out, so a keyword inside e.g.
 * status = 'DELETED' can't trigger it) for these keywords at any paren depth.
 *
 * The negative lookahead `(?!\s*\()` exempts same-named scalar FUNCTIONS —
 * most importantly REPLACE(a, 'x', 'y'), a legitimate read-only string
 * function in PostgreSQL/Trino. A data-modifying STATEMENT is never written as
 * `KEYWORD(`, so requiring the keyword not to be a function call avoids
 * false-positives without weakening the check (it cannot exempt a real write).
 */
const DANGEROUS_KEYWORD =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE|REPLACE|GRANT|REVOKE|EXEC|EXECUTE|CALL|COPY|UNLOAD)\b(?!\s*\()/i;
const VALID_SELECT = /^\s*(SELECT|WITH)\b/i;

/**
 * Returns `query` with the CONTENTS of string literals ('...' and "...") and
 * comments (-- to end of line, and block comments) replaced by spaces, so the
 * keyword scan can't be fooled by a keyword that only appears inside a string
 * (e.g. `WHERE status = 'DELETED'`) or a comment (`-- delete old rows`).
 * Non-string/comment characters and overall length are preserved.
 *
 * Note: like the scanners in queryShape.ts, `''`-style escaping inside a
 * single-quoted string is treated as two adjacent strings; this only ever
 * leaves stray individual characters as "code", never a full keyword, so it
 * doesn't affect the scan.
 */
function blankStringsAndComments(query: string): string {
  let out = "";
  let inString: string | null = null;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    const next = query[i + 1];
    if (inString) {
      out += ch === "\n" ? "\n" : " ";
      if (ch === inString) inString = null;
      continue;
    }
    // Line comment: blank through end of line.
    if (ch === "-" && next === "-") {
      while (i < query.length && query[i] !== "\n") {
        out += " ";
        i++;
      }
      out += i < query.length ? "\n" : "";
      continue;
    }
    // Block comment: blank through the closing */.
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < query.length && !(query[i] === "*" && query[i + 1] === "/")) {
        out += query[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < query.length) {
        out += "  ";
        i += 1; // for-loop's i++ consumes the second char of */
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      inString = ch;
      out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Throws if the query is not a single read-only SELECT (or WITH...SELECT).
 */
export function assertReadOnly(query: string, engine: string): void {
  const trimmed = query.trim();

  if (!trimmed) {
    throw new Error("Empty query.");
  }

  // Must start with SELECT or WITH (for CTEs).
  if (!VALID_SELECT.test(trimmed)) {
    throw new Error(
      `Refused to execute ${engine} query: must start with SELECT or WITH. ` +
        `Got: "${trimmed.substring(0, 40)}..."`,
    );
  }

  // Blank strings/comments once, then reuse for both remaining checks.
  const sanitized = blankStringsAndComments(trimmed);

  // Reject any data-modifying keyword anywhere in the query (including inside
  // or after a CTE), not just at the start — see DANGEROUS_KEYWORD.
  const dangerous = sanitized.match(DANGEROUS_KEYWORD);
  if (dangerous) {
    throw new Error(
      `Refused to execute ${engine} query: only SELECT statements are allowed ` +
        `(found "${dangerous[1].toUpperCase()}"). Got: "${trimmed.substring(0, 40)}..."`,
    );
  }

  // Reject multiple statements (semicolon followed by non-whitespace).
  if (/;\s*\S/.test(sanitized)) {
    throw new Error(
      `Refused to execute ${engine} query: multiple statements not allowed.`,
    );
  }
}
