/**
 * Fetches the full stored record for one execution from the configured
 * destination — the "expand a results-table row" path. Extracted vscode-free
 * (like queryService) so the VS Code extension and the desktop app share the
 * destination dispatch instead of each maintaining a copy.
 */
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import type { InsightConfig } from "./configCore";
import { fetchLogsInsightsRecord } from "./logsInsights";
import { fetchDynamoDBRecord } from "./dynamodb";
import { fetchAuroraRecord } from "./aurora";
import { fetchRedshiftRecord } from "./redshift";
import { fetchOpenSearchRecord } from "./opensearch";
import { fetchAthenaRecord } from "./athena";

export interface FetchDetailArgs {
  idValue: string;
  /** Athena partition hints (optional). */
  year?: string;
  month?: string;
  day?: string;
}

/** Returns the record's fields, or undefined when no record matches. */
export async function fetchDetailRecord(
  cfg: InsightConfig,
  credentials: AwsCredentialIdentityProvider,
  args: FetchDetailArgs,
): Promise<Record<string, string> | undefined> {
  const { idValue, year, month, day } = args;
  if (cfg.destinationType === "dynamodb") {
    return fetchDynamoDBRecord({
      region: cfg.region,
      credentials,
      tableName: cfg.dynamodbTableName,
      pk: idValue,
    });
  }
  if (cfg.destinationType === "aurora") {
    return fetchAuroraRecord({
      region: cfg.region,
      credentials,
      resourceArn: cfg.auroraResourceArn,
      secretArn: cfg.auroraSecretArn,
      database: cfg.auroraDatabase,
      table: cfg.auroraTable,
      executionArn: idValue,
    });
  }
  if (cfg.destinationType === "redshift") {
    return fetchRedshiftRecord({
      region: cfg.region,
      credentials,
      database: cfg.redshiftDatabase,
      workgroupName: cfg.redshiftWorkgroupName || undefined,
      clusterIdentifier: cfg.redshiftClusterIdentifier || undefined,
      dbUser: cfg.redshiftDbUser || undefined,
      secretArn: cfg.redshiftSecretArn || undefined,
      table: `${cfg.redshiftSchema}.${cfg.redshiftTable}`,
      executionArn: idValue,
    });
  }
  if (cfg.destinationType === "opensearch") {
    return fetchOpenSearchRecord({
      region: cfg.region,
      credentials,
      endpoint: cfg.opensearchEndpoint,
      index: cfg.opensearchIndex,
      executionArn: idValue,
    });
  }
  if (cfg.destinationType === "s3") {
    return fetchAthenaRecord({
      region: cfg.region,
      credentials,
      database: cfg.athenaDatabase,
      table: cfg.athenaTable,
      workgroup: cfg.athenaWorkgroup || undefined,
      outputLocation: cfg.athenaOutputLocation || undefined,
      executionArn: idValue,
      year,
      month,
      day,
    });
  }
  return fetchLogsInsightsRecord({
    region: cfg.region,
    credentials,
    logGroupNames: cfg.logGroupNames,
    executionArn: idValue,
  });
}
