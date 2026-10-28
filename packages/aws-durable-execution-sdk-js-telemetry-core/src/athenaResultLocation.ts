/**
 * Where Athena writes query results, relative to the table's data.
 *
 * Athena writes a result file for every query, including Test connection's
 * `SELECT 1`. If the result location is inside the table's data location, the
 * table reads those files as records, so every query adds rows. Read-only
 * credentials do not prevent this, because Athena must be allowed to write its
 * results. So Test connection checks the location before it runs its probe.
 */
import type { TelemetryConfig } from "./configCore";
import type { resolveCredentials } from "./configCore";
import { getTableLocation, getWorkGroupOutput } from "./athena";

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
