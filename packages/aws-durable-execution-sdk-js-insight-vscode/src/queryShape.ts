/**
 * Detects whether a generated query is row-level (one result row = one
 * execution, so a stable identifier column can be added for drill-down) or
 * an aggregate/summary query (GROUP BY, bare COUNT/SUM/AVG/MIN/MAX with no
 * grouping — e.g. "how many executions failed") where there is no single
 * execution a result row corresponds to, so injecting an identifier column
 * would be meaningless (or, for some engines, outright invalid SQL).
 *
 * This directly answers the question a customer asked while building this
 * feature: "what if it's not possible at all, like 'show me the count of
 * executions in the past 3 hours'?" — aggregate queries are detected here so
 * the identifier-injection and row-detail drill-down are skipped entirely
 * for them, rather than trying to force an impossible per-row identity onto
 * a single summary row.
 */

const GROUP_BY_RE = /\bgroup\s+by\b/i;
// Bare aggregate function calls: COUNT(, SUM(, AVG(, MIN(, MAX(. This alone
// (without GROUP BY) also collapses all matching rows into one summary row
// for that column (e.g. "SELECT COUNT(*) FROM ..." -> exactly one row, not
// one row per execution), so it's just as disqualifying as GROUP BY.
const AGGREGATE_FN_RE = /\b(?:count|sum|avg|min|max)\s*\(/i;
// CloudWatch Logs Insights uses a pipe-based `stats` command instead of SQL
// aggregate functions/GROUP BY.
const LOGS_INSIGHTS_STATS_RE = /\|\s*stats\b/i;

export function isAggregateQuery(
  query: string,
  dialect: "sql" | "logs-insights",
): boolean {
  if (dialect === "logs-insights") {
    return LOGS_INSIGHTS_STATS_RE.test(query);
  }
  return GROUP_BY_RE.test(query) || AGGREGATE_FN_RE.test(query);
}

export interface IdentifierInjectionResult {
  query: string;
  /** The column the row's identifier will appear under in the result set, or undefined if no identifier could be added (aggregate query, or dialect-specific reasons). */
  idColumn?: string;
  /**
   * Columns from `extraColumns` that were actually ensured present in the
   * result set (added if missing, alongside idColumn) — undefined/empty for
   * aggregate queries, same as idColumn. Currently used to carry Athena's
   * year/month/day partition columns through to the row-detail fetch, so
   * that fetch can add a partition-pruning predicate instead of scanning
   * every partition on every row click.
   */
  extraColumns?: string[];
}

/**
 * If `query` is row-level (not aggregate), ensures its SELECT list includes
 * `idColumn` (adding it if missing) so every result row carries a stable
 * identifier the UI can use to fetch the full record on demand. No-op for
 * aggregate queries — returns the query unchanged with no idColumn.
 *
 * `extraColumns` (optional) are ensured present the same way, for columns
 * the drill-down fetch wants available even though they're not identifiers
 * themselves — e.g. Athena's year/month/day partition columns, so the
 * fetch-by-id query (see fetchAthenaRecord) can prune partitions instead of
 * scanning the whole table on every row click.
 *
 * This is deliberately conservative: it only handles the common
 * `SELECT <list> FROM ...` shape (optionally preceded by a `WITH` CTE clause,
 * which passes through untouched since only the final SELECT's column list
 * matters for the result shape). If the shape isn't recognized, it leaves the
 * query untouched and reports no idColumn/extraColumns rather than risk
 * producing invalid SQL — the UI simply won't offer row-level drill-down (or
 * partition pruning) for that result set.
 */
export function ensureIdentifierColumn(
  query: string,
  idColumn: string,
  dialect: "sql" | "logs-insights",
  extraColumns: string[] = [],
): IdentifierInjectionResult {
  const trimmed = query.trim();

  if (dialect === "logs-insights") {
    if (isAggregateQuery(trimmed, dialect)) return { query: trimmed };
    // Logs Insights: a `fields` command explicitly lists output fields; if
    // present, make sure idColumn (and any extraColumns) are among them. If
    // there's no `fields` command, every field is already included by
    // default, so everything is already present — nothing to inject.
    const fieldsMatch = trimmed.match(/\|\s*fields\s+([^|]+)/i);
    if (!fieldsMatch) {
      return { query: trimmed, idColumn, extraColumns: [...extraColumns] };
    }
    const present = fieldsMatch[1].split(",").map((f) => f.trim());
    const toAdd = [idColumn, ...extraColumns].filter(
      (c) => !present.includes(c),
    );
    if (toAdd.length === 0) {
      return { query: trimmed, idColumn, extraColumns: [...extraColumns] };
    }
    // Trim trailing whitespace from the matched field list before appending,
    // so injection doesn't leave "fieldA, fieldB idColumn" (missing comma) or
    // "fieldA, fieldBidColumn|" (missing space before the next pipe) — the
    // match's trailing whitespace (if the fields command is directly
    // followed by " |") is preserved separately in `rest` further down.
    const trimmedFieldsMatch = fieldsMatch[0].replace(/\s+$/, "");
    const trailingWhitespace = fieldsMatch[0].slice(trimmedFieldsMatch.length);
    const injected = trimmed.replace(
      fieldsMatch[0],
      `${trimmedFieldsMatch}, ${toAdd.join(", ")}${trailingWhitespace}`,
    );
    return { query: injected, idColumn, extraColumns: [...extraColumns] };
  }

  // SQL dialects (PartiQL, PostgreSQL, Trino/Presto): only handle a single
  // top-level SELECT list. Bail out (no injection) for anything containing
  // `SELECT *` (idColumn is necessarily already included), a top-level set
  // operator (UNION/INTERSECT/EXCEPT — see hasTopLevelSetOperator; injecting
  // into just the last branch would corrupt column counts across branches),
  // or other shapes this simple parser can't confidently rewrite (subqueries
  // in the FROM clause, etc.) — better to skip drill-down than corrupt SQL.
  if (isAggregateQuery(trimmed, dialect)) return { query: trimmed };
  if (hasTopLevelSetOperator(trimmed)) return { query: trimmed };

  const outer = findOuterSelect(trimmed);
  if (!outer) return { query: trimmed };
  const { prefix, columnList, fromKeyword, rest } = outer;

  if (
    /^\s*\*\s*$/.test(columnList) ||
    /\*\s*,|\bselect\s+\*/i.test(columnList)
  ) {
    // SELECT * already includes every column, including the identifier.
    return { query: trimmed, idColumn, extraColumns: [...extraColumns] };
  }

  const columns = splitTopLevel(columnList);
  const toAdd = [idColumn, ...extraColumns].filter(
    (c) => !columns.some((existing) => referencesColumn(existing, c)),
  );
  if (toAdd.length === 0) {
    return { query: trimmed, idColumn, extraColumns: [...extraColumns] };
  }

  const injected = `${prefix}${columnList}, ${toAdd.join(", ")}${fromKeyword}${rest}`;
  return { query: injected, idColumn, extraColumns: [...extraColumns] };
}

/**
 * Whether `query` contains a top-level (not inside parens, not inside a
 * string literal) UNION, UNION ALL, INTERSECT, or EXCEPT — i.e. multiple
 * SELECT branches combined into one result set. `findOuterSelect`'s
 * "last top-level SELECT" heuristic only identifies one branch of a set
 * operation, and injecting an identifier into just that branch would
 * produce a column-count mismatch across branches (invalid SQL) or, if the
 * branches already happen to have matching counts, silently wrong data
 * (the identifier would only appear correctly aligned in one branch's
 * output rows). Detecting this and skipping injection entirely is the safe
 * choice — a query shape this rare from an LLM-generated single-question
 * query isn't worth a more elaborate per-branch rewrite.
 */
function hasTopLevelSetOperator(query: string): boolean {
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inString = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0) {
      const rest = query.slice(i);
      const match = rest.match(/^(union(\s+all)?|intersect|except)\b/i);
      if (match) {
        const before = query[i - 1];
        if (!before || /\W/.test(before)) return true;
      }
    }
  }
  return false;
}

/**
 * Finds the outermost SELECT's column list — i.e. the LAST top-level (not
 * inside parens) `SELECT ... FROM` in the query. This is deliberately "last"
 * rather than "first": a `WITH cte AS (SELECT ...) SELECT ... FROM cte`
 * shape has its real result-shaping SELECT after the CTE(s), and matching
 * the first SELECT would rewrite the CTE's inner list instead — corrupting
 * the CTE but leaving the actual output column list (and thus the row
 * shape the UI sees) untouched.
 *
 * This function alone does NOT handle UNION/INTERSECT/EXCEPT — for
 * `SELECT a FROM t UNION SELECT b FROM t`, "last top-level SELECT" finds the
 * second branch, and injecting there would corrupt the query (mismatched
 * column counts across branches). Callers must check
 * `hasTopLevelSetOperator` first and skip injection entirely if true;
 * `ensureIdentifierColumn` does this before calling `findOuterSelect`.
 */
function findOuterSelect(
  query: string,
):
  | { prefix: string; columnList: string; fromKeyword: string; rest: string }
  | undefined {
  let depth = 0;
  let inString: string | null = null;
  let lastSelectIndex = -1;

  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inString = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && /select/i.test(query.slice(i, i + 6))) {
      // Word-boundary check so this doesn't match inside e.g. "reselect".
      const before = query[i - 1];
      const after = query[i + 6];
      if ((!before || /\W/.test(before)) && (!after || /\W/.test(after))) {
        lastSelectIndex = i;
      }
    }
  }

  if (lastSelectIndex === -1) return undefined;

  const afterSelect = query.slice(lastSelectIndex + 6);
  const fromMatch = afterSelect.match(/^([\s\S]*?)(\s+from\s)/i);
  if (!fromMatch) return undefined;

  const prefix = query.slice(0, lastSelectIndex + 6) + " ";
  const columnList = fromMatch[1].trim();
  const fromKeyword = fromMatch[2];
  const rest = afterSelect.slice(fromMatch[0].length);
  return { prefix, columnList, fromKeyword, rest };
}

/** Splits a SELECT column list on top-level commas (ignoring commas inside parens/quotes). */
function splitTopLevel(columnList: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let inString: string | null = null;
  for (const ch of columnList) {
    if (inString) {
      current += ch;
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Whether a SELECT list entry already references idColumn (as itself, an alias, or qualified with a table/alias prefix). */
function referencesColumn(selectItem: string, idColumn: string): boolean {
  const item = selectItem.trim();
  const idLower = idColumn.toLowerCase();
  // Matches: idColumn | "idColumn" | t.idColumn | t."idColumn" | ... AS idColumn
  const re = new RegExp(`(^|[."\\s])${escapeRegExp(idLower)}("|\\s|$)`, "i");
  return re.test(item.toLowerCase());
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * SQL/PartiQL identifiers are case-insensitive, so `ensureIdentifierColumn`
 * matches/injects `idColumn` case-insensitively — but the actual result set
 * carries whatever case the query text used (e.g. a query that already
 * selected `executionArn` keeps that exact casing in the returned columns,
 * even though `idColumn` was checked against as `executionarn`). The
 * webview does an exact-case property lookup (`row[idColumn]`), so before
 * reporting `idColumn` to it, resolve it against the *actual* result
 * columns and use whichever casing really appears there — otherwise the
 * lookup silently fails and row-click does nothing.
 *
 * Returns undefined if idColumn genuinely isn't present in `columns` (e.g.
 * the destination executed a rewritten query that dropped it somehow) —
 * callers should treat that the same as "no idColumn" rather than reporting
 * a column that isn't actually in the result set.
 */
export function resolveActualColumnCasing(
  idColumn: string | undefined,
  columns: string[],
): string | undefined {
  if (!idColumn) return undefined;
  const idLower = idColumn.toLowerCase();
  return columns.find((c) => c.toLowerCase() === idLower);
}
