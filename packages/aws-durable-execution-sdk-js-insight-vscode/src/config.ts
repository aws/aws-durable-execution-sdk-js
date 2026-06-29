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
    | "aurora";
  dynamodbTableName: string;
  auroraResourceArn: string;
  auroraSecretArn: string;
  auroraDatabase: string;
  auroraTable: string;
  llmProvider: "bedrock" | "copilot" | "local";
  awsProfile?: string;
  bedrockModelId: string;
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
          : ("cloudwatch-logs-exporter" as const);
  const dynamodbTableName = (c.get<string>("dynamodbTableName") || "").trim();
  const auroraResourceArn = (c.get<string>("auroraResourceArn") || "").trim();
  const auroraSecretArn = (c.get<string>("auroraSecretArn") || "").trim();
  const auroraDatabase =
    (c.get<string>("auroraDatabase") || "").trim() || "postgres";
  const auroraTable =
    (c.get<string>("auroraTable") || "").trim() || "workflow_insight";
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

  return {
    region,
    logGroupNames,
    destinationType,
    dynamodbTableName,
    auroraResourceArn,
    auroraSecretArn,
    auroraDatabase,
    auroraTable,
    llmProvider,
    awsProfile,
    bedrockModelId,
  };
}

export function resolveCredentials(
  profile?: string,
): AwsCredentialIdentityProvider {
  return profile ? fromIni({ profile }) : fromNodeProviderChain();
}
