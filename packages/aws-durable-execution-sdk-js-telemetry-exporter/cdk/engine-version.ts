import {
  DescribeDBEngineVersionsCommand,
  RDSClient,
} from "@aws-sdk/client-rds";

/** The engine of the stack's Aurora cluster. */
const ENGINE = "aurora-postgresql";

/** The `major.minor` form that `AuroraPostgresEngineVersion.of` expects. */
const VERSION_FORMAT = /^\d+\.\d+$/;

/** The one RDS call this check makes, so a test can replace the client. */
export interface EngineVersionClient {
  send(command: DescribeDBEngineVersionsCommand): Promise<{
    DBEngineVersions?: { EngineVersion?: string }[];
  }>;
}

/**
 * Fails synth when `version` is not an Aurora PostgreSQL version that RDS
 * offers in `region`.
 *
 * Without this check, an unsupported version fails only when CloudFormation
 * creates the cluster. By then the VPC and the other resources already exist,
 * and the stack rolls back. So the check runs at synth time, before anything is
 * created.
 *
 * Cases:
 * 1. The value is not `major.minor`: throws, without calling AWS.
 * 2. RDS lists the version: returns.
 * 3. RDS does not list it: throws, naming the versions of the same major
 *    version that RDS does list.
 * 4. The RDS call itself fails (no credentials, no network): logs a warning
 *    and returns. Synth then still works offline, and the version is checked
 *    at deploy time as before.
 */
export async function assertAuroraEngineVersionAvailable(
  version: string,
  region: string | undefined,
  client: EngineVersionClient = new RDSClient(region ? { region } : {}),
): Promise<void> {
  if (!VERSION_FORMAT.test(version)) {
    throw new Error(
      `destinations.aurora.engineVersion "${version}" is not in major.minor form, for example "17.9".`,
    );
  }

  let listed: string[];
  try {
    const response = await client.send(
      new DescribeDBEngineVersionsCommand({
        Engine: ENGINE,
        EngineVersion: version.split(".")[0],
      }),
    );
    listed = (response.DBEngineVersions ?? [])
      .map((v) => v.EngineVersion)
      .filter((v): v is string => v !== undefined);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(
      `Could not check destinations.aurora.engineVersion "${version}" against RDS (${reason}). ` +
        `An unsupported version fails at deploy time.`,
    );
    return;
  }

  if (listed.includes(version)) return;

  // RDS also lists variants such as "16.4-limitless"; only plain versions fit
  // the major.minor form above.
  const available = listed.filter((v) => VERSION_FORMAT.test(v));
  throw new Error(
    `destinations.aurora.engineVersion "${version}" is not offered for ${ENGINE} in ` +
      `${region ?? "the configured region"}. ` +
      (available.length > 0
        ? `Available ${version.split(".")[0]}.x versions: ${available.join(", ")}.`
        : `RDS lists no ${version.split(".")[0]}.x versions.`),
  );
}
