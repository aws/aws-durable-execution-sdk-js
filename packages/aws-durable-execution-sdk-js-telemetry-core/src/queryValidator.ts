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
 * The lexical rules of one engine that decide where a literal or a comment
 * starts and ends. The scanner below needs them because it must split a query
 * into code, literals and comments the same way the engine does.
 *
 * - `backslashEscapes`: a backslash inside a quoted literal can escape the
 *   closing quote. Then `'\''` is one complete literal to the engine, but two
 *   literals with code between them to a scanner that only knows `''`.
 * - `mysqlComments`: the engine follows the MySQL comment rules. `#` starts a
 *   line comment, and `--` starts one only when whitespace follows.
 * - `backtickQuotes`: a backtick starts a quoted identifier that ends at the
 *   next backtick.
 */
interface Dialect {
  backslashEscapes: boolean;
  mysqlComments: boolean;
  backtickQuotes: boolean;
}

/**
 * Evidence for each entry is listed in the pull request that introduced this
 * table. In summary:
 *
 * - PostgreSQL: `E'...'` literals take backslash escapes. `#` is an operator
 *   (for example the `#>>` JSON path operator), not a comment.
 * - Redshift: plain `'...'` literals take backslash escapes. The documented
 *   `QUOTE_LITERAL` function doubles backslashes for this reason.
 * - Trino (Athena engine v3): quotes are escaped only by doubling.
 * - PartiQL for DynamoDB: the DynamoDB developer guide states that a backslash
 *   does not escape a single quote. A backtick starts an Ion literal, whose
 *   strings can contain a backtick, so backticks are rejected.
 * - OpenSearch SQL: its lexer grammar is derived from MySQL. Literals and
 *   backtick identifiers take backslash escapes, and `#` and `-- ` start line
 *   comments.
 */
const DIALECTS: Record<string, Dialect> = {
  PostgreSQL: {
    backslashEscapes: true,
    mysqlComments: false,
    backtickQuotes: false,
  },
  "Redshift SQL": {
    backslashEscapes: true,
    mysqlComments: false,
    backtickQuotes: false,
  },
  "Trino/Presto SQL": {
    backslashEscapes: false,
    mysqlComments: false,
    backtickQuotes: false,
  },
  PartiQL: {
    backslashEscapes: false,
    mysqlComments: false,
    backtickQuotes: false,
  },
  "OpenSearch SQL": {
    backslashEscapes: true,
    mysqlComments: true,
    backtickQuotes: true,
  },
};

/** An unknown engine gets every restriction. This is the fail-closed choice. */
const STRICTEST: Dialect = {
  backslashEscapes: true,
  mysqlComments: true,
  backtickQuotes: false,
};

function refuse(engine: string, reason: string): never {
  throw new Error(`Refused to execute ${engine} query: ${reason}`);
}

/**
 * Returns `query` with the CONTENTS of string literals ('...'), quoted
 * identifiers ("...", and `...` on OpenSearch) and comments replaced by
 * spaces, so the keyword scan can't be fooled by a keyword that only appears
 * inside a string (e.g. `WHERE status = 'DELETED'`) or a comment
 * (`-- delete old rows`). Non-string/comment characters and overall length are
 * preserved.
 *
 * WHY THIS SCANNER THROWS INSTEAD OF GUESSING.
 *
 * 1. The keyword scan is correct only if this scanner splits the query into
 *    code, literals and comments the same way the engine does.
 * 2. Any construct the two split differently lets a caller hide code from the
 *    scan. Example: PostgreSQL reads `$$'$$` as one dollar-quoted literal. A
 *    scanner that does not know dollar-quoting reads the `'` as the start of a
 *    literal. So in `SELECT $$'$$; DELETE FROM t; --'` that scanner blanks the
 *    DELETE, and PostgreSQL runs it.
 * 3. So the scanner accepts only constructs whose boundaries it knows for the
 *    given engine. It rejects the query when it meets any other construct:
 *    - `$` outside a literal (PostgreSQL and Redshift dollar-quoting);
 *    - a backslash inside a literal, when `backslashEscapes` is set;
 *    - `#` or `--` outside a literal, when `mysqlComments` is set (supporting
 *      MySQL comment rules would need more cases than the queries need);
 *    - a backtick outside a literal, when `backtickQuotes` is not set;
 *    - `/*` inside a block comment (PostgreSQL nests block comments, so the
 *      first `*\/` does not always end the comment);
 *    - an unterminated literal or block comment.
 *
 * A `--` line comment ends at `\n` or `\r`, as it does in PostgreSQL and Trino.
 * An engine that ends the comment later only hides less code than this scanner
 * assumes, so the difference is safe.
 *
 * Note: like the scanners in queryShape.ts, `''`-style escaping inside a
 * single-quoted string is treated as two adjacent strings; this only ever
 * leaves stray individual characters as "code", never a full keyword, so it
 * doesn't affect the scan.
 */
function blankStringsAndComments(query: string, engine: string): string {
  const dialect = DIALECTS[engine] ?? STRICTEST;
  let out = "";
  let inString: string | null = null;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    const next = query[i + 1];
    if (inString) {
      if (ch === "\\" && dialect.backslashEscapes) {
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
    if (dialect.mysqlComments && (ch === "#" || (ch === "-" && next === "-"))) {
      refuse(engine, 'line comments ("--" or "#") are not allowed.');
    }
    // Line comment: blank through end of line (\n or \r).
    if (ch === "-" && next === "-") {
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
    if (ch === "`" && !dialect.backtickQuotes) {
      refuse(engine, "backticks are not allowed outside a quoted string.");
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
