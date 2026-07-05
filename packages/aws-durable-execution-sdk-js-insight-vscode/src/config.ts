import * as vscode from "vscode";
import { fromIni, fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";

export interface InsightConfig {
  region: string;
  logGroupNames: string[];
  destinationType:
    | "cloudwatch-logs-exporter"
    | "lambda-log-exporter"
    | "dynamodb"
    | "aurora"
    | "sqs"
    | "s3";
  dynamodbTableName: string;
  auroraResourceArn: string;
  auroraSecretArn: string;
  auroraDatabase: string;
  auroraTable: string;
  sqsQueueUrl: string;
  sqsDeleteAfterRead: boolean;
  athenaDatabase: string;
  athenaTable: string;
  athenaWorkgroup: string;
  athenaOutputLocation: string;
  athenaS3Location: string;
  llmProvider: "bedrock" | "copilot" | "local";
  awsProfile?: string;
  bedrockModelId: string;
  agenticMaxIterations: number;
  agenticMaxScannedMB: number;
}

const SECTION = "workflowInsight";

export function readConfig(): InsightConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  const region =
    (c.get<string>("region") || "").trim() ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "us-east-1";
  const logGroupNames = (c.get<string>("logGroupName") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const raw = (c.get<string>("destinationType") || "").trim();
  const destinationType =
    raw === "lambda-log-exporter"
      ? ("lambda-log-exporter" as const)
      : raw === "dynamodb"
        ? ("dynamodb" as const)
        : raw === "aurora"
          ? ("aurora" as const)
          : raw === "sqs"
            ? ("sqs" as const)
            : raw === "s3"
              ? ("s3" as const)
              : ("cloudwatch-logs-exporter" as const);
  const dynamodbTableName = (c.get<string>("dynamodbTableName") || "").trim();
  const auroraResourceArn = (c.get<string>("auroraResourceArn") || "").trim();
  const auroraSecretArn = (c.get<string>("auroraSecretArn") || "").trim();
  const auroraDatabase =
    (c.get<string>("auroraDatabase") || "").trim() || "postgres";
  const auroraTable =
    (c.get<string>("auroraTable") || "").trim() || "workflow_insight";
  const sqsQueueUrl = (c.get<string>("sqsQueueUrl") || "").trim();
  const sqsDeleteAfterRead = c.get<boolean>("sqsDeleteAfterRead") ?? false;
  const athenaDatabase = (c.get<string>("athenaDatabase") || "").trim();
  const athenaTable =
    (c.get<string>("athenaTable") || "").trim() || "workflow_insight";
  const athenaWorkgroup = (c.get<string>("athenaWorkgroup") || "").trim();
  const athenaOutputLocation = (
    c.get<string>("athenaOutputLocation") || ""
  ).trim();
  const athenaS3Location = (c.get<string>("athenaS3Location") || "").trim();
  const llmProvider =
    (c.get<string>("llmProvider") || "").trim() === "copilot"
      ? ("copilot" as const)
      : (c.get<string>("llmProvider") || "").trim() === "local"
        ? ("local" as const)
        : ("bedrock" as const);
  const awsProfile = (c.get<string>("awsProfile") || "").trim() || undefined;
  const bedrockModelId =
    (c.get<string>("bedrockModelId") || "").trim() ||
    "us.anthropic.claude-sonnet-4-20250514-v1:0";
  const rawMaxIter = c.get<number>("agenticMaxIterations");
  const agenticMaxIterations =
    typeof rawMaxIter === "number" && Number.isFinite(rawMaxIter)
      ? Math.min(20, Math.max(1, Math.floor(rawMaxIter)))
      : 8;
  const rawMaxMB = c.get<number>("agenticMaxScannedMB");
  const agenticMaxScannedMB =
    typeof rawMaxMB === "number" && Number.isFinite(rawMaxMB) && rawMaxMB > 0
      ? Math.floor(rawMaxMB)
      : 2048;

  return {
    region,
    logGroupNames,
    destinationType,
    dynamodbTableName,
    auroraResourceArn,
    auroraSecretArn,
    auroraDatabase,
    auroraTable,
    sqsQueueUrl,
    sqsDeleteAfterRead,
    athenaDatabase,
    athenaTable,
    athenaWorkgroup,
    athenaOutputLocation,
    athenaS3Location,
    llmProvider,
    awsProfile,
    bedrockModelId,
    agenticMaxIterations,
    agenticMaxScannedMB,
  };
}

export function resolveCredentials(
  profile?: string,
): AwsCredentialIdentityProvider {
  return profile ? fromIni({ profile }) : fromNodeProviderChain();
}
