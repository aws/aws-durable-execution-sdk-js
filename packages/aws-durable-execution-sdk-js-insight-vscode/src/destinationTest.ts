import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { SQSClient, GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import type { InsightConfig } from "./config";
import { resolveCredentials } from "./config";
import { tableExists, runAthenaQuery } from "./athena";
import { runAuroraQuery } from "./aurora";
import { runRedshiftQuery } from "./redshift";
import { pingOpenSearch } from "./opensearch";

/**
 * Result of a single check within a destination test (e.g. "Glue table exists",
 * "Athena test query"). `ok: false` means the check failed; `detail` carries a
 * human-readable explanation shown under the check.
 */
export interface DestinationCheck {
  label: string;
  ok: boolean;
  detail?: string;
}

/**
 * Outcome of testing a configured destination end-to-end: an overall pass/fail
 * plus the individual checks that were run. Surfaced inline in the Settings
 * modal so users can confirm a destination is reachable and its config complete
 * BEFORE saving (and before running real queries).
 */
export interface DestinationTestReport {
  ok: boolean;
  summary: string;
  checks: DestinationCheck[];
}

/** Awaits a connectivity probe and turns success/throw into a DestinationCheck. */
async function probe(
  label: string,
  fn: () => Promise<string | undefined>,
): Promise<DestinationCheck> {
  try {
    const detail = await fn();
    return { label, ok: true, detail };
  } catch (err) {
    return {
      label,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function report(checks: DestinationCheck[]): DestinationTestReport {
  const ok = checks.every((c) => c.ok);
  return {
    ok,
    summary: ok
      ? "All checks passed — this destination is reachable and ready to query."
      : "Some checks failed. Fix the items marked below, then test again.",
    checks,
  };
}

/**
 * Runs read-only connectivity + completeness checks for the configured
 * destination. Never writes data — creating the Glue table stays on Save; the
 * Athena test only reports whether the table already exists.
 *
 * Scope: this is a client-side connectivity/completeness check only. It cannot
 * fully validate IAM beyond the specific read-only calls it happens to make —
 * e.g. a role that can DescribeTable but lacks the permissions the actual query
 * path uses later would still pass here. Treat a green result as "reachable and
 * configured", not "every downstream operation is authorized".
 */
export async function testDestination(
  cfg: InsightConfig,
): Promise<DestinationTestReport> {
  const credentials = resolveCredentials(cfg.awsProfile);

  switch (cfg.destinationType) {
    case "s3":
      return testAthena(cfg, credentials);
    case "dynamodb":
      return testDynamoDB(cfg, credentials);
    case "aurora":
      return testAurora(cfg, credentials);
    case "redshift":
      return testRedshift(cfg, credentials);
    case "opensearch":
      return testOpenSearch(cfg, credentials);
    case "sqs":
      return testSqs(cfg, credentials);
    case "cloudwatch-logs-exporter":
    case "lambda-log-exporter":
      return testCloudWatchLogs(cfg, credentials);
    default:
      return report([
        {
          label: "Destination type",
          ok: false,
          detail: `Unsupported destination type: ${cfg.destinationType}`,
        },
      ]);
  }
}

async function testAthena(
  cfg: InsightConfig,
  credentials: ReturnType<typeof resolveCredentials>,
): Promise<DestinationTestReport> {
  const checks: DestinationCheck[] = [];

  const missing: string[] = [];
  if (!cfg.athenaDatabase) missing.push("Glue Database");
  if (!cfg.athenaS3Location) missing.push("S3 Location");
  // Note: athenaTable is never blank here — normalizeConfig() defaults it to
  // "workflow_insight" — so it can't be reported missing.
  checks.push({
    label: "Required fields",
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `Database "${cfg.athenaDatabase}", table "${cfg.athenaTable}".`
        : `Missing: ${missing.join(", ")}.`,
  });

  if (!cfg.athenaWorkgroup && !cfg.athenaOutputLocation) {
    checks.push({
      label: "Query result location",
      ok: true,
      detail:
        "No workgroup or result location set — the 'primary' workgroup will be used. The test query below confirms whether it has an output location configured.",
    });
  }

  // Can't probe further without the identifiers the calls require.
  if (missing.length > 0) return report(checks);

  checks.push(
    await probe("Glue table exists", async () => {
      const exists = await tableExists({
        region: cfg.region,
        credentials,
        database: cfg.athenaDatabase,
        table: cfg.athenaTable,
      });
      return exists
        ? `${cfg.athenaDatabase}.${cfg.athenaTable} is present.`
        : `${cfg.athenaDatabase}.${cfg.athenaTable} does not exist yet — it will be created automatically when you Save.`;
    }),
  );

  // SELECT 1 exercises the workgroup / output-location / Athena permissions
  // without scanning the data. This is what catches the common "primary
  // workgroup with no result location" misconfiguration.
  checks.push(
    await probe("Athena test query (SELECT 1)", async () => {
      await runAthenaQuery({
        region: cfg.region,
        credentials,
        database: cfg.athenaDatabase,
        workgroup: cfg.athenaWorkgroup || undefined,
        outputLocation: cfg.athenaOutputLocation || undefined,
        query: "SELECT 1",
      });
      return "Athena executed a query successfully.";
    }),
  );

  return report(checks);
}

async function testDynamoDB(
  cfg: InsightConfig,
  credentials: ReturnType<typeof resolveCredentials>,
): Promise<DestinationTestReport> {
  const checks: DestinationCheck[] = [];
  checks.push({
    label: "Required fields",
    ok: Boolean(cfg.dynamodbTableName),
    detail: cfg.dynamodbTableName
      ? `Table "${cfg.dynamodbTableName}".`
      : "Missing: DynamoDB Table Name.",
  });
  if (!cfg.dynamodbTableName) return report(checks);

  checks.push(
    await probe("DynamoDB table exists", async () => {
      const client = new DynamoDBClient({ region: cfg.region, credentials });
      const out = await client.send(
        new DescribeTableCommand({ TableName: cfg.dynamodbTableName }),
      );
      const status = out.Table?.TableStatus ?? "UNKNOWN";
      return `Table "${cfg.dynamodbTableName}" found (status: ${status}).`;
    }),
  );
  return report(checks);
}

async function testAurora(
  cfg: InsightConfig,
  credentials: ReturnType<typeof resolveCredentials>,
): Promise<DestinationTestReport> {
  const checks: DestinationCheck[] = [];
  const missing: string[] = [];
  if (!cfg.auroraResourceArn) missing.push("Aurora Cluster ARN");
  if (!cfg.auroraSecretArn) missing.push("Aurora Secret ARN");
  if (!cfg.auroraDatabase) missing.push("Database");
  checks.push({
    label: "Required fields",
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `Database "${cfg.auroraDatabase}".`
        : `Missing: ${missing.join(", ")}.`,
  });
  if (missing.length > 0) return report(checks);

  checks.push(
    await probe("Aurora Data API connection (SELECT 1)", async () => {
      await runAuroraQuery({
        region: cfg.region,
        credentials,
        resourceArn: cfg.auroraResourceArn,
        secretArn: cfg.auroraSecretArn,
        database: cfg.auroraDatabase,
        sql: "SELECT 1",
      });
      return "Connected to the cluster via the RDS Data API.";
    }),
  );
  return report(checks);
}

async function testRedshift(
  cfg: InsightConfig,
  credentials: ReturnType<typeof resolveCredentials>,
): Promise<DestinationTestReport> {
  const checks: DestinationCheck[] = [];
  const missing: string[] = [];
  // Serverless (workgroup) or provisioned (cluster) — need exactly one.
  if (!cfg.redshiftWorkgroupName && !cfg.redshiftClusterIdentifier)
    missing.push("Workgroup name or Cluster identifier");
  if (!cfg.redshiftDatabase) missing.push("Database");
  checks.push({
    label: "Required fields",
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `${
            cfg.redshiftWorkgroupName
              ? `Workgroup "${cfg.redshiftWorkgroupName}"`
              : `Cluster "${cfg.redshiftClusterIdentifier}"`
          }, database "${cfg.redshiftDatabase}", table "${cfg.redshiftSchema}.${cfg.redshiftTable}".`
        : `Missing: ${missing.join(", ")}.`,
  });
  if (missing.length > 0) return report(checks);

  checks.push(
    await probe("Redshift Data API connection (SELECT 1)", async () => {
      await runRedshiftQuery({
        region: cfg.region,
        credentials,
        database: cfg.redshiftDatabase,
        workgroupName: cfg.redshiftWorkgroupName || undefined,
        clusterIdentifier: cfg.redshiftClusterIdentifier || undefined,
        dbUser: cfg.redshiftDbUser || undefined,
        secretArn: cfg.redshiftSecretArn || undefined,
        sql: "SELECT 1",
      });
      return "Connected and ran a statement via the Redshift Data API.";
    }),
  );
  return report(checks);
}

async function testOpenSearch(
  cfg: InsightConfig,
  credentials: ReturnType<typeof resolveCredentials>,
): Promise<DestinationTestReport> {
  const checks: DestinationCheck[] = [];
  const missing: string[] = [];
  if (!cfg.opensearchEndpoint) missing.push("Domain endpoint");
  checks.push({
    label: "Required fields",
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `Endpoint "${cfg.opensearchEndpoint}", index "${cfg.opensearchIndex}".`
        : `Missing: ${missing.join(", ")}.`,
  });
  if (missing.length > 0) return report(checks);

  checks.push(
    await probe("OpenSearch connection (SigV4)", async () => {
      return await pingOpenSearch({
        region: cfg.region,
        credentials,
        endpoint: cfg.opensearchEndpoint,
      });
    }),
  );
  return report(checks);
}

async function testSqs(
  cfg: InsightConfig,
  credentials: ReturnType<typeof resolveCredentials>,
): Promise<DestinationTestReport> {
  const checks: DestinationCheck[] = [];
  checks.push({
    label: "Required fields",
    ok: Boolean(cfg.sqsQueueUrl),
    detail: cfg.sqsQueueUrl ? cfg.sqsQueueUrl : "Missing: SQS Queue URL.",
  });
  if (!cfg.sqsQueueUrl) return report(checks);

  checks.push(
    await probe("SQS queue reachable", async () => {
      const client = new SQSClient({ region: cfg.region, credentials });
      const out = await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: cfg.sqsQueueUrl,
          AttributeNames: ["ApproximateNumberOfMessages"],
        }),
      );
      const n = out.Attributes?.ApproximateNumberOfMessages ?? "unknown";
      return `Queue reachable (~${n} messages available).`;
    }),
  );
  return report(checks);
}

async function testCloudWatchLogs(
  cfg: InsightConfig,
  credentials: ReturnType<typeof resolveCredentials>,
): Promise<DestinationTestReport> {
  const checks: DestinationCheck[] = [];
  checks.push({
    label: "Required fields",
    ok: cfg.logGroupNames.length > 0,
    detail:
      cfg.logGroupNames.length > 0
        ? `${cfg.logGroupNames.length} log group(s) configured.`
        : "Missing: Log Group Name.",
  });
  if (cfg.logGroupNames.length === 0) return report(checks);

  // Lambda creates its own log group (/aws/lambda/<fn>) on first invocation, so
  // a not-yet-existing group is expected rather than a misconfiguration —
  // mirror the Athena "will be created" nuance and treat it as a pass-with-note.
  const autoCreated = cfg.destinationType === "lambda-log-exporter";

  const client = new CloudWatchLogsClient({ region: cfg.region, credentials });
  for (const name of cfg.logGroupNames) {
    checks.push(
      await probe(`Log group "${name}"`, async () => {
        const found = await logGroupExists(client, name);
        if (found) return "Found and accessible.";
        if (autoCreated) {
          return "Not created yet — Lambda creates this group on the function's first invocation.";
        }
        throw new Error(
          "No log group with this exact name was found (records won't be readable until it exists).",
        );
      }),
    );
  }
  return report(checks);
}

/**
 * Whether a log group with this EXACT name exists. DescribeLogGroups only
 * filters by prefix, so we page through matches (via nextToken) looking for the
 * exact name — otherwise an account with >1 page of same-prefix groups could
 * report a false "not found" if the exact match isn't on the first page.
 */
async function logGroupExists(
  client: CloudWatchLogsClient,
  name: string,
): Promise<boolean> {
  let nextToken: string | undefined;
  do {
    const out = await client.send(
      new DescribeLogGroupsCommand({
        logGroupNamePrefix: name,
        limit: 50,
        nextToken,
      }),
    );
    if ((out.logGroups ?? []).some((g) => g.logGroupName === name)) return true;
    nextToken = out.nextToken;
  } while (nextToken);
  return false;
}
