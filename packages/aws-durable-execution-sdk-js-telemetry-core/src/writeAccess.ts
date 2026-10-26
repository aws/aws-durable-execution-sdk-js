/**
 * Detects whether running read-only queries against a destination could still
 * change data, so the hosts can warn the customer.
 *
 * WHY ONLY THREE DESTINATIONS ARE CHECKED.
 *
 * 1. `assertReadOnly` refuses a second statement and every write keyword. So a
 *    write can only come from something legal inside one SELECT.
 * 2. On Aurora PostgreSQL a SELECT can call a function that writes. On Redshift
 *    a SELECT can call a Lambda UDF. So on these two engines this module asks
 *    the database for the user's superuser status, the tables it can write,
 *    and the functions it can call that run with another role's privileges.
 * 3. On S3 + Athena a SELECT cannot write. But Athena writes each query's
 *    results to the result location. If that location is inside the table's
 *    data location, the table reads the result files as records. So every
 *    query adds rows, and this module compares the two locations.
 * 4. DynamoDB PartiQL, OpenSearch SQL and CloudWatch Logs Insights have no way
 *    for one SELECT to write, so they report `not-checked` with that reason.
 *
 * This module runs its own catalog queries. They are fixed SELECTs written
 * here, not model output, so they do not go through `assertReadOnly`.
 */
import type { TelemetryConfig } from "./configCore";
import { resolveCredentials } from "./configCore";
import { runAuroraQuery } from "./aurora";
import { runRedshiftQuery } from "./redshift";
import { getTableLocation, getWorkGroupOutput } from "./athena";

export type WriteAccessResult =
  /** The check ran and found no way for a query to change data. */
  | { status: "read-only" }
  /** The check ran and found at least one way. `findings` names each one. */
  | { status: "can-write"; findings: string[] }
  /** The destination has no way for one SELECT to write, or the check lacks an input. */
  | { status: "not-checked"; reason: string }
  /** The check itself failed, for example because the destination is unreachable. */
  | { status: "unknown"; reason: string };

/** Lists at most this many tables, and this many functions, so the warning stays short. */
const MAX_LISTED_TABLES = 5;

const POSTGRES_SUPERUSER_SQL =
  "SELECT rolsuper FROM pg_roles WHERE rolname = current_user";

/**
 * `has_table_privilege(oid, ...)` resolves role membership, so a privilege the
 * user holds through a group role is found too. A table in a schema without
 * USAGE cannot be written, so those schemas are skipped.
 */
const POSTGRES_WRITABLE_TABLES_SQL = `SELECT n.nspname || '.' || c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND has_schema_privilege(n.oid, 'USAGE')
  AND (has_table_privilege(c.oid, 'INSERT') OR has_table_privilege(c.oid, 'UPDATE')
    OR has_table_privilege(c.oid, 'DELETE') OR has_table_privilege(c.oid, 'TRUNCATE'))
LIMIT ${MAX_LISTED_TABLES}`;

const REDSHIFT_SUPERUSER_SQL =
  "SELECT usesuper FROM pg_user WHERE usename = current_user";

/**
 * System schemas are skipped with `LEFT(schemaname, 3) <> 'pg_'`, not with
 * `NOT LIKE 'pg\_%'`. Redshift reads a backslash in a string literal as an
 * escape, so `\_` reaches LIKE as `_`, a wildcard, and a schema such as
 * `pgdata` would be skipped. The LEFT comparison needs no escape on either
 * engine.
 *
 * Unverified against a live Redshift cluster; tested on PostgreSQL 16, whose
 * catalog functions Redshift inherits. Redshift's `has_table_privilege` takes a
 * table name, and resolving a name in a schema without USAGE raises "permission
 * denied for schema". SQL does not fix the order of AND operands, so the CASE
 * checks USAGE first and only then resolves the name.
 */
const REDSHIFT_WRITABLE_TABLES_SQL = `SELECT schemaname || '.' || tablename
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  AND LEFT(schemaname, 3) <> 'pg_'
  AND CASE WHEN has_schema_privilege(schemaname, 'USAGE')
    THEN has_table_privilege(quote_ident(schemaname) || '.' || quote_ident(tablename), 'INSERT')
      OR has_table_privilege(quote_ident(schemaname) || '.' || quote_ident(tablename), 'UPDATE')
      OR has_table_privilege(quote_ident(schemaname) || '.' || quote_ident(tablename), 'DELETE')
    ELSE false END
LIMIT ${MAX_LISTED_TABLES}`;

/**
 * A SECURITY DEFINER function runs with its owner's privileges. So a user with
 * no writable table can still write by calling one that another role owns and
 * the user may execute. A function the user owns runs with the user's own
 * privileges, which the table query already covers, so those are skipped.
 */
const POSTGRES_DEFINER_FUNCTIONS_SQL = `SELECT p.oid::regprocedure::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND p.proowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user)
  AND has_schema_privilege(n.oid, 'USAGE')
  AND has_function_privilege(p.oid, 'EXECUTE')
LIMIT ${MAX_LISTED_TABLES}`;

/**
 * Redshift: a Lambda UDF (language `exfunc`) runs code with the Lambda
 * function's role, and a SECURITY DEFINER function runs with its owner's
 * privileges. Unverified against a live Redshift cluster. It does not check
 * EXECUTE privilege, because Redshift's `has_function_privilege` takes a
 * signature string this query cannot build reliably. So it can list a
 * function the user cannot call; that only adds a warning.
 */
const REDSHIFT_RISKY_FUNCTIONS_SQL = `SELECT n.nspname || '.' || p.proname
FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND LEFT(n.nspname, 3) <> 'pg_'
  AND (l.lanname = 'exfunc'
    OR (p.prosecdef AND p.proowner <> (SELECT usesysid FROM pg_user WHERE usename = current_user)))
LIMIT ${MAX_LISTED_TABLES}`;

/**
 * Builds the findings from the three catalog query results. The Data API
 * returns a boolean column as the string "true" or "false".
 */
function databaseFindings(
  superuserRows: string[][],
  writableRows: string[][],
  functionRows: string[][],
): WriteAccessResult {
  const findings: string[] = [];
  if (superuserRows[0]?.[0] === "true") {
    findings.push("The database user is a superuser.");
  }
  for (const [table] of writableRows) {
    findings.push(`The database user can write table ${table}.`);
  }
  for (const [fn] of functionRows) {
    findings.push(
      `A query can call function ${fn}, which runs with another role's ` +
        `privileges and can write.`,
    );
  }
  return findings.length > 0
    ? { status: "can-write", findings }
    : { status: "read-only" };
}

/**
 * Ends an S3 URI with `/`, so a prefix comparison cannot match `s3://b/data`
 * against `s3://b/data-results`.
 */
function withTrailingSlash(uri: string): string {
  const trimmed = uri.trim();
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

/**
 * The location Athena actually writes results to. A workgroup with
 * EnforceWorkGroupConfiguration replaces the location a query submits, so the
 * workgroup is read even when `athenaOutputLocation` is set. Athena uses the
 * `primary` workgroup when none is configured. Reading the workgroup needs
 * `athena:GetWorkGroup`; if that fails, the error reaches `checkWriteAccess`,
 * which returns `unknown`.
 */
async function effectiveOutputLocation(
  cfg: TelemetryConfig,
  credentials: ReturnType<typeof resolveCredentials>,
): Promise<string | undefined> {
  const workgroup = await getWorkGroupOutput({
    region: cfg.region,
    credentials,
    workgroup: cfg.athenaWorkgroup || "primary",
  });
  if (workgroup.enforced) return workgroup.outputLocation;
  return cfg.athenaOutputLocation || workgroup.outputLocation;
}

async function checkAthena(
  cfg: TelemetryConfig,
  credentials: ReturnType<typeof resolveCredentials>,
): Promise<WriteAccessResult> {
  const outputLocation = await effectiveOutputLocation(cfg, credentials);
  if (!outputLocation) {
    return {
      status: "not-checked",
      reason:
        "Neither the settings nor the Athena workgroup set a result location.",
    };
  }
  const tableLocation = await getTableLocation({
    region: cfg.region,
    credentials,
    database: cfg.athenaDatabase,
    table: cfg.athenaTable,
  });
  const dataLocation = tableLocation ?? (cfg.athenaS3Location || undefined);
  if (!dataLocation) {
    return {
      status: "not-checked",
      reason: "The table does not exist and no S3 data location is set.",
    };
  }
  const results = withTrailingSlash(outputLocation);
  const data = withTrailingSlash(dataLocation);
  if (results.startsWith(data)) {
    return {
      status: "can-write",
      findings: [
        `Athena writes query results to ${outputLocation}, which is ` +
          `inside the table's data location ${dataLocation}. The table reads ` +
          `those result files as records, so every query adds rows. Move the ` +
          `result location outside the data location.`,
      ],
    };
  }
  return { status: "read-only" };
}

/**
 * Checks whether queries through these tools could change data at `cfg`'s
 * destination. Never throws: a failure of the check itself is returned as
 * `unknown`.
 */
export async function checkWriteAccess(
  cfg: TelemetryConfig,
): Promise<WriteAccessResult> {
  const credentials = resolveCredentials(cfg.awsProfile);
  try {
    switch (cfg.destinationType) {
      case "aurora": {
        const conn = {
          region: cfg.region,
          credentials,
          resourceArn: cfg.auroraResourceArn,
          secretArn: cfg.auroraSecretArn,
          database: cfg.auroraDatabase,
        };
        const superuser = await runAuroraQuery({
          ...conn,
          sql: POSTGRES_SUPERUSER_SQL,
        });
        const writable = await runAuroraQuery({
          ...conn,
          sql: POSTGRES_WRITABLE_TABLES_SQL,
        });
        const functions = await runAuroraQuery({
          ...conn,
          sql: POSTGRES_DEFINER_FUNCTIONS_SQL,
        });
        return databaseFindings(superuser.rows, writable.rows, functions.rows);
      }
      case "redshift": {
        const conn = {
          region: cfg.region,
          credentials,
          database: cfg.redshiftDatabase,
          workgroupName: cfg.redshiftWorkgroupName || undefined,
          clusterIdentifier: cfg.redshiftClusterIdentifier || undefined,
          dbUser: cfg.redshiftDbUser || undefined,
          secretArn: cfg.redshiftSecretArn || undefined,
        };
        const superuser = await runRedshiftQuery({
          ...conn,
          sql: REDSHIFT_SUPERUSER_SQL,
        });
        const writable = await runRedshiftQuery({
          ...conn,
          sql: REDSHIFT_WRITABLE_TABLES_SQL,
        });
        const functions = await runRedshiftQuery({
          ...conn,
          sql: REDSHIFT_RISKY_FUNCTIONS_SQL,
        });
        return databaseFindings(superuser.rows, writable.rows, functions.rows);
      }
      case "s3":
        return await checkAthena(cfg, credentials);
      default:
        return {
          status: "not-checked",
          reason:
            "A single read-only query cannot change data on this destination.",
        };
    }
  } catch (err) {
    return {
      status: "unknown",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
