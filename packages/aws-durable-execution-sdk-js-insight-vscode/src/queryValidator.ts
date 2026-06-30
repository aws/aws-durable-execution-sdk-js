/**
 * Validates that a SQL/PartiQL query is read-only (SELECT only).
 * Rejects any statement that could mutate data.
 *
 * This is a defense-in-depth measure since queries are LLM-generated
 * and could be hallucinated or prompt-injected. Customers should also
 * configure their DB credentials with read-only permissions.
 */

const DANGEROUS_KEYWORDS =
  /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE|REPLACE|GRANT|REVOKE|EXEC|EXECUTE|CALL|COPY|UNLOAD)\b/i;
const VALID_SELECT = /^\s*(SELECT|WITH)\b/i;

/**
 * Throws if the query is not a single read-only SELECT (or WITH...SELECT).
 */
export function assertReadOnly(query: string, engine: string): void {
  const trimmed = query.trim();

  if (!trimmed) {
    throw new Error("Empty query.");
  }

  // Check for dangerous keywords at statement start
  if (DANGEROUS_KEYWORDS.test(trimmed)) {
    throw new Error(
      `Refused to execute ${engine} query: only SELECT statements are allowed. ` +
        `Got: "${trimmed.substring(0, 40)}..."`,
    );
  }

  // Must start with SELECT or WITH (for CTEs)
  if (!VALID_SELECT.test(trimmed)) {
    throw new Error(
      `Refused to execute ${engine} query: must start with SELECT or WITH. ` +
        `Got: "${trimmed.substring(0, 40)}..."`,
    );
  }

  // Reject multiple statements (semicolon followed by non-whitespace)
  const withoutStrings = trimmed.replace(/'[^']*'/g, ""); // strip string literals
  if (/;\s*\S/.test(withoutStrings)) {
    throw new Error(
      `Refused to execute ${engine} query: multiple statements not allowed.`,
    );
  }
}
