import {
  DescribeDBEngineVersionsCommand,
  RDSClient,
} from "@aws-sdk/client-rds";

/** The engine of the stack's Aurora cluster. */
const ENGINE = "aurora-postgresql";

/** The `major.minor` form that `AuroraPostgresEngineVersion.of` expects. */
const VERSION_FORMAT = /^\d+\.\d+$/;

/** The CDK context key that skips this check, for example on `cdk destroy`. */
export const SKIP_CONTEXT_KEY = "skipEngineVersionCheck";

/** The IAM action this check calls. */
const PERMISSION = "rds:DescribeDBEngineVersions";

/** The Aurora settings this check compares with what RDS offers. */
export interface AuroraEngineSettings {
  engineVersion: string;
  minCapacity: number;
  maxCapacity: number;
}

/** The parts of the RDS client this check uses, so a test can replace it. */
export interface EngineVersionClient {
  send(command: DescribeDBEngineVersionsCommand): Promise<{
    DBEngineVersions?: {
      EngineVersion?: string;
      ServerlessV2FeaturesSupport?: {
        MinCapacity?: number;
        MaxCapacity?: number;
      };
    }[];
  }>;
  /** The region the client resolved, when none was passed in. */
  config?: { region?: () => Promise<string> };
}

/**
 * Fails synth when the configured Aurora PostgreSQL version cannot run the
 * stack's Serverless v2 cluster in `region`.
 *
 * Without this check, an unsupported version fails only when CloudFormation
 * creates the cluster. By then the VPC and the other resources already exist,
 * and the stack rolls back. So the check runs at synth time, before anything is
 * created.
 *
 * Cases:
 * 1. The version is not `major.minor`: throws, without calling AWS.
 * 2. RDS does not list the version for new clusters: throws, naming the
 *    versions of the same major version that RDS does list.
 * 3. RDS lists the version without Serverless v2 support: throws. The stack
 *    always creates a Serverless v2 writer, so the deploy would fail.
 * 4. `minCapacity` or `maxCapacity` is outside the range RDS allows for the
 *    version: throws.
 * 5. Otherwise: returns.
 * 6. The RDS call itself fails: logs a warning and returns, so synth still
 *    works offline and the version is checked at deploy time as before. A
 *    rejected call (an HTTP 4xx from RDS) names the permission the check needs.
 *    Failing synth instead would block a user who deploys through the CDK
 *    bootstrap roles without holding that permission personally.
 *
 * Every CDK command runs the app, including `cdk destroy`. A version that RDS
 * retires after the stack was deployed would then block the teardown. So every
 * error names the `-c skipEngineVersionCheck=true` opt-out, and app.ts skips
 * the check when it is set.
 */
export async function assertAuroraEngineVersionAvailable(
  settings: AuroraEngineSettings,
  region: string | undefined,
  client: EngineVersionClient = new RDSClient(region ? { region } : {}),
): Promise<void> {
  const { engineVersion: version, minCapacity, maxCapacity } = settings;
  const major = version.split(".")[0];
  const fail = (problem: string): Error =>
    new Error(
      `${problem} To skip this check, for example to run \`cdk destroy\` after RDS retired ` +
        `the version, pass \`-c ${SKIP_CONTEXT_KEY}=true\`.`,
    );

  if (!VERSION_FORMAT.test(version)) {
    throw fail(
      `destinations.aurora.engineVersion "${version}" is not in major.minor form, for example "17.9".`,
    );
  }

  let listed: NonNullable<
    Awaited<ReturnType<EngineVersionClient["send"]>>["DBEngineVersions"]
  >;
  try {
    const response = await client.send(
      new DescribeDBEngineVersionsCommand({
        Engine: ENGINE,
        EngineVersion: major,
      }),
    );
    listed = response.DBEngineVersions ?? [];
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const status = (err as { $metadata?: { httpStatusCode?: number } })
      ?.$metadata?.httpStatusCode;
    const rejected = status !== undefined && status >= 400 && status < 500;
    console.warn(
      `Could not check destinations.aurora.engineVersion "${version}" against RDS (${reason}). ` +
        (rejected
          ? `RDS rejected the call; the check needs valid credentials with the ${PERMISSION} permission. `
          : "") +
        `An unsupported version fails at deploy time.`,
    );
    return;
  }

  const where = `in ${region ?? (await resolvedRegion(client)) ?? "the resolved region"}`;
  const deployedHint =
    "For a stack that is already deployed, use the cluster's current version: " +
    "a different version upgrades the cluster in place.";

  const match = listed.find((v) => v.EngineVersion === version);
  if (!match) {
    // RDS also lists variants such as "16.4-limitless"; only plain versions fit
    // the major.minor form above.
    const available = listed
      .map((v) => v.EngineVersion)
      .filter((v): v is string => v !== undefined && VERSION_FORMAT.test(v));
    throw fail(
      `destinations.aurora.engineVersion "${version}" is not offered for ${ENGINE} ${where}. ` +
        (available.length > 0
          ? `Available ${major}.x versions: ${available.join(", ")}. `
          : `RDS lists no ${major}.x versions. `) +
        deployedHint,
    );
  }

  const serverless = match.ServerlessV2FeaturesSupport;
  if (!serverless) {
    throw fail(
      `destinations.aurora.engineVersion "${version}" does not support Aurora Serverless v2 ${where}, ` +
        `and this stack creates a Serverless v2 cluster. ${deployedHint}`,
    );
  }
  const { MinCapacity: lowest, MaxCapacity: highest } = serverless;
  if (
    (lowest !== undefined && minCapacity < lowest) ||
    (highest !== undefined && maxCapacity > highest)
  ) {
    throw fail(
      `destinations.aurora minCapacity ${minCapacity} and maxCapacity ${maxCapacity} are outside ` +
        `the Serverless v2 range for ${ENGINE} ${version} ${where} ` +
        `(${lowest ?? "?"} to ${highest ?? "?"} ACUs).`,
    );
  }
}

/** The region an SDK client resolved, or undefined when it cannot say. */
async function resolvedRegion(
  client: EngineVersionClient,
): Promise<string | undefined> {
  try {
    return await client.config?.region?.();
  } catch {
    return undefined;
  }
}
