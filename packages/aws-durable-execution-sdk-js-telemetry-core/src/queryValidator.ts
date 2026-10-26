/**
 * Validates that a SQL/PartiQL query is read-only (SELECT only).
 * Rejects any statement that could mutate data.
 *
 * This is defense in depth, NOT a security boundary. Queries are LLM-generated
 * and can be hallucinated or prompt-injected, and a text-level check cannot
 * know every side effect a database can perform from inside a SELECT (for
 * example a PostgreSQL function that writes). The boundary is the database
 * credential: customers must give the identity these tools use read-only
 * permissions on the destination. The READMEs of the VS Code, desktop and MCP
 * hosts say so.
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
 * INTO is listed because `SELECT ... INTO new_table FROM t` creates a table in
 * PostgreSQL and Redshift. A read-only query never needs INTO; INSERT INTO is
 * already caught by INSERT.
 *
 * The negative lookahead `(?!\s*\()` exempts same-named scalar FUNCTIONS —
 * most importantly REPLACE(a, 'x', 'y'), a legitimate read-only string
 * function in PostgreSQL/Trino. A data-modifying STATEMENT is never written as
 * `KEYWORD(`, so requiring the keyword not to be a function call avoids
 * false-positives without weakening the check (it cannot exempt a real write).
 */
const DANGEROUS_KEYWORD =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE|REPLACE|GRANT|REVOKE|EXEC|EXECUTE|CALL|COPY|UNLOAD|INTO)\b(?!\s*\()/i;
const VALID_SELECT = /^\s*(SELECT|WITH)\b/i;

/**
 * Engines whose string literals treat a backslash as an ordinary character.
 * Every other engine label (including any label not listed here) is assumed to
 * treat a backslash as an escape character, which is the fail-closed choice.
 *
 * - Trino/Presto SQL (Athena): `'a\'` is a complete literal.
 * - PartiQL (DynamoDB): quotes are escaped only by doubling.
 *
 * PostgreSQL treats a backslash as an escape inside `E'...'` literals, and
 * Redshift (and PostgreSQL with standard_conforming_strings off) inside plain
 * `'...'` literals. OpenSearch SQL accepts `\'` inside a literal.
 */
const BACKSLASH_IS_LITERAL = new Set(["Trino/Presto SQL", "PartiQL"]);

/**
 * Engines that may read `#` as the start of a line comment. OpenSearch SQL
 * derives from the MySQL grammar, which does. Unknown engines are treated the
 * same way. PostgreSQL is not in this set because `#` is its XOR operator and
 * the `#>` / `#>>` JSON path operators are common in queries over the
 * `record_json` column.
 */
function hashMayStartComment(engine: string): boolean {
  return ![
    "PostgreSQL",
    "Redshift SQL",
    "Trino/Presto SQL",
    "PartiQL",
  ].includes(engine);
}

function refuse(engine: string, reason: string): never {
  throw new Error(`Refused to execute ${engine} query: ${reason}`);
}

/**
 * Returns `query` with the CONTENTS of string literals ('...'), quoted
 * identifiers ("..." and `...`) and comments (-- to end of line, and block
 * comments) replaced by spaces, so the keyword scan can't be fooled by a keyword
 * that only appears inside a string (e.g. `WHERE status = 'DELETED'`) or a
 * comment (`-- delete old rows`). Non-string/comment characters and overall
 * length are preserved.
 *
 * Backtick-quoted text is treated as a quoted region on every engine. OpenSearch
 * SQL uses it for index names that contain `-` (the structured MCP tools emit
 * it), and Trino lexes it as one token. PostgreSQL and Redshift reject the
 * character, so the database fails the query before running anything.
 *
 * WHY THIS SCANNER THROWS INSTEAD OF GUESSING.
 *
 * The keyword scan is only correct if this scanner splits the query into code,
 * strings and comments exactly as the database does. Any construct the two
 * disagree on lets a caller hide code from the scan. Example: PostgreSQL reads
 * `$$'$$` as one dollar-quoted string, but a scanner that does not know
 * dollar-quoting reads the `'` as the start of a string. In
 *
 *   SELECT $$'$$; DELETE FROM t; --'
 *
 * that scanner blanks `; DELETE FROM t; --` as string content, while
 * PostgreSQL runs the DELETE.
 *
 * The supported engines have different lexical rules, so this scanner does not
 * try to model each one. It accepts only the subset on which all of them agree
 * and REJECTS the query when it meets anything outside that subset:
 *
 * - `$` outside a literal: PostgreSQL/Redshift dollar-quoting (`$$...$$`,
 *   `$tag$...$tag$`).
 * - A backslash outside a literal, or inside one on an engine where it is an
 *   escape character (see BACKSLASH_IS_LITERAL): `E'\''` and Redshift `'\''`
 *   are one complete literal each.
 * - `#` outside a literal on an engine that may read it as a comment.
 * - `--` followed by a non-whitespace character: MySQL-derived grammars
 *   (OpenSearch SQL) start a comment only at `-- ` followed by whitespace.
 * - `/*` inside a block comment: PostgreSQL nests block comments, so the first
 *   `*\/` does not always end the comment.
 * - An unterminated literal or block comment.
 *
 * Line comments end at `\n` OR `\r`, as they do in PostgreSQL and Trino. Ending
 * a comment early only exposes more text to the keyword scan, which is the safe
 * direction.
 *
 * Note: like the scanners in queryShape.ts, `''`-style escaping inside a
 * single-quoted string is treated as two adjacent strings; this only ever
 * leaves stray individual characters as "code", never a full keyword, so it
 * doesn't affect the scan.
 */
function blankStringsAndComments(query: string, engine: string): string {
  const backslashIsLiteral = BACKSLASH_IS_LITERAL.has(engine);
  const hashIsCode = !hashMayStartComment(engine);
  let out = "";
  let inString: string | null = null;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    const next = query[i + 1];
    if (inString) {
      if (ch === "\\" && !backslashIsLiteral) {
        refuse(
          engine,
          "a backslash inside a quoted string or identifier is not allowed, " +
            "because this engine can read it as an escape character.",
        );
      }
      out += ch === "\n" ? "\n" : " ";
      if (ch === inString) inString = null;
      continue;
    }
    // Line comment: blank through end of line (\n or \r).
    if (ch === "-" && next === "-") {
      const after = query[i + 2];
      if (after !== undefined && !/\s/.test(after)) {
        refuse(
          engine,
          'a "--" comment must be followed by whitespace or end the query.',
        );
      }
      while (i < query.length && query[i] !== "\n" && query[i] !== "\r") {
        out += " ";
        i++;
      }
      if (i < query.length) out += query[i];
      continue;
    }
    // Block comment: blank through the closing */.
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < query.length && !(query[i] === "*" && query[i + 1] === "/")) {
        if (query[i] === "/" && query[i + 1] === "*") {
          refuse(engine, "nested block comments are not allowed.");
        }
        out += query[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i >= query.length) {
        refuse(engine, "unterminated block comment.");
      }
      out += "  ";
      i += 1; // for-loop's i++ consumes the second char of */
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inString = ch;
      out += " ";
      continue;
    }
    if (ch === "$") {
      refuse(
        engine,
        '"$" is not allowed outside a quoted string (dollar-quoted strings ' +
          "are not supported).",
      );
    }
    if (ch === "\\") {
      refuse(engine, "a backslash is not allowed outside a quoted string.");
    }
    if (ch === "#" && !hashIsCode) {
      refuse(engine, '"#" is not allowed outside a quoted string.');
    }
    out += ch;
  }
  if (inString) {
    refuse(engine, "unterminated quoted string or identifier.");
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

  // Blank strings/comments once, then reuse for both remaining checks. Throws
  // on any construct the supported engines could lex differently.
  const sanitized = blankStringsAndComments(trimmed, engine);

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
