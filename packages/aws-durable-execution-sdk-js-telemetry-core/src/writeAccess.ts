/**
 * Looks for ways that read-only queries could still change data at a
 * destination, so the hosts can warn the customer and ask for consent.
 *
 * WHY THERE IS NO "READ-ONLY" RESULT.
 *
 * 1. `assertReadOnly` refuses a second statement and every write keyword. So a
 *    write can only come from something legal inside one SELECT.
 * 2. On PostgreSQL such a SELECT can write through tables, superuser status,
 *    SECURITY DEFINER functions, sequences, extensions such as dblink, and
 *    more. The list has no fixed end, so no set of catalog queries can show
 *    that a user cannot write.
 * 3. So a finding gives `can-write`, and no finding gives `unverified`: the
 *    tools could not confirm the credentials are read-only, and checking them
 *    is the customer's responsibility. Both ask for the customer's consent.
 *
 * What is checked:
 * - Aurora PostgreSQL: superuser status, writable tables, sequences the user
 *   can advance or reset, and SECURITY DEFINER functions of other roles.
 * - Redshift: superuser status, writable tables, Lambda UDFs and other roles'
 *   SECURITY DEFINER functions.
 * - S3 + Athena: whether Athena writes query results inside the table's data,
 *   where the table reads them as records.
 * - Other destinations: nothing; the result is `unverified`.
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
  /** The check found at least one way to change data. `findings` names each one. */
  | { status: "can-write"; findings: string[] }
  /**
   * The check found no way, could not look, or failed. `reason` says which.
   * This is not a statement that the credentials are read-only.
   */
  | { status: "unverified"; reason: string };

/** Ends every `unverified` reason. */
const CUSTOMER_DUTY =
  "It is your responsibility to give these tools read-only credentials.";

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

/**
 * `nextval` needs USAGE or UPDATE on a sequence, and `setval` needs UPDATE.
 * Both change the sequence's state for good, even inside a SELECT.
 */
const POSTGRES_WRITABLE_SEQUENCES_SQL = `SELECT n.nspname || '.' || c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'S'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND has_schema_privilege(n.oid, 'USAGE')
  AND (has_sequence_privilege(c.oid, 'USAGE') OR has_sequence_privilege(c.oid, 'UPDATE'))
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

/** Rows of each catalog query. The Data API returns booleans as "true"/"false". */
interface CatalogRows {
  superuser: string[][];
  tables: string[][];
  sequences: string[][];
  functions: string[][];
}

function databaseFindings(rows: CatalogRows): WriteAccessResult {
  const findings: string[] = [];
  if (rows.superuser[0]?.[0] === "true") {
    findings.push("The database user is a superuser.");
  }
  for (const [table] of rows.tables) {
    findings.push(`The database user can write table ${table}.`);
  }
  for (const [sequence] of rows.sequences) {
    findings.push(
      `The database user can advance or reset sequence ${sequence} ` +
        `(nextval/setval).`,
    );
  }
  for (const [fn] of rows.functions) {
    findings.push(
      `A query can call function ${fn}, which runs with another role's ` +
        `privileges and can write.`,
    );
  }
  if (findings.length > 0) return { status: "can-write", findings };
  return {
    status: "unverified",
    reason:
      "No write privilege was found, but a SELECT on this engine can still " +
      "change data through functions and extensions this check cannot see. " +
      CUSTOMER_DUTY,
  };
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
 * Where Athena writes query results relative to the table's data.
 *
 * - `inside`: every query writes a result file the table then reads as rows.
 * - `outside`: queries do not add rows.
 * - `undetermined`: the location could not be established; `reason` says why.
 *
 * A workgroup with EnforceWorkGroupConfiguration replaces the location a query
 * submits, so the workgroup is read (with `athena:GetWorkGroup`) even when
 * `athenaOutputLocation` is set. Athena uses `primary` when no workgroup is
 * configured. Test connection calls this before its Athena probe, because the
 * probe itself writes a result file.
 */
export type AthenaResultLocation =
  | { kind: "inside"; finding: string }
  | { kind: "outside" }
  | { kind: "undetermined"; reason: string };

export async function checkAthenaResultLocation(
  cfg: TelemetryConfig,
  credentials: ReturnType<typeof resolveCredentials>,
): Promise<AthenaResultLocation> {
  let outputLocation: string | undefined;
  let dataLocation: string | undefined;
  try {
    const workgroup = await getWorkGroupOutput({
      region: cfg.region,
      credentials,
      workgroup: cfg.athenaWorkgroup || "primary",
    });
    outputLocation = workgroup.enforced
      ? workgroup.outputLocation
      : cfg.athenaOutputLocation || workgroup.outputLocation;
    const tableLocation = await getTableLocation({
      region: cfg.region,
      credentials,
      database: cfg.athenaDatabase,
      table: cfg.athenaTable,
    });
    dataLocation = tableLocation ?? (cfg.athenaS3Location || undefined);
  } catch (err) {
    return {
      kind: "undetermined",
      reason: `Could not read the Athena workgroup or Glue table: ${errorMessage(err)}`,
    };
  }
  if (!outputLocation) {
    return {
      kind: "undetermined",
      reason:
        "Neither the settings nor the Athena workgroup set a result location.",
    };
  }
  if (!dataLocation) {
    return {
      kind: "undetermined",
      reason: "The table does not exist and no S3 data location is set.",
    };
  }
  if (
    withTrailingSlash(outputLocation).startsWith(
      withTrailingSlash(dataLocation),
    )
  ) {
    return {
      kind: "inside",
      finding:
        `Athena writes query results to ${outputLocation}, which is inside ` +
        `the table's data location ${dataLocation}. The table reads those ` +
        `result files as records, so every query adds rows. Move the result ` +
        `location outside the data location.`,
    };
  }
  return { kind: "outside" };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Looks for ways queries through these tools could change data at `cfg`'s
 * destination. Never throws: a failure of the check itself is returned as
 * `unverified` with the error as the reason.
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
        const tables = await runAuroraQuery({
          ...conn,
          sql: POSTGRES_WRITABLE_TABLES_SQL,
        });
        const sequences = await runAuroraQuery({
          ...conn,
          sql: POSTGRES_WRITABLE_SEQUENCES_SQL,
        });
        const functions = await runAuroraQuery({
          ...conn,
          sql: POSTGRES_DEFINER_FUNCTIONS_SQL,
        });
        return databaseFindings({
          superuser: superuser.rows,
          tables: tables.rows,
          sequences: sequences.rows,
          functions: functions.rows,
        });
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
        const tables = await runRedshiftQuery({
          ...conn,
          sql: REDSHIFT_WRITABLE_TABLES_SQL,
        });
        const functions = await runRedshiftQuery({
          ...conn,
          sql: REDSHIFT_RISKY_FUNCTIONS_SQL,
        });
        // Redshift has no sequences (it uses IDENTITY columns).
        return databaseFindings({
          superuser: superuser.rows,
          tables: tables.rows,
          sequences: [],
          functions: functions.rows,
        });
      }
      case "s3": {
        const location = await checkAthenaResultLocation(cfg, credentials);
        if (location.kind === "inside") {
          return { status: "can-write", findings: [location.finding] };
        }
        return {
          status: "unverified",
          reason:
            (location.kind === "undetermined"
              ? `${location.reason} `
              : "Athena writes query results outside the table's data. ") +
            "These tools cannot read the identity's S3 and Glue permissions. " +
            CUSTOMER_DUTY,
        };
      }
      default:
        return {
          status: "unverified",
          reason:
            "These tools cannot read this destination's permissions. " +
            CUSTOMER_DUTY,
        };
    }
  } catch (err) {
    return {
      status: "unverified",
      reason: `The check could not run: ${errorMessage(err)} ${CUSTOMER_DUTY}`,
    };
  }
}
