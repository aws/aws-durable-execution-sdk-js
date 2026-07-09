import * as vscode from "vscode";
import { fromIni, fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import type { DestinationType } from "./schema";

export interface InsightConfig {
  region: string;
  logGroupNames: string[];
  destinationType: DestinationType;
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
  llmProvider: "bedrock" | "copilot" | "local" | "local-server";
  awsProfile?: string;
  bedrockModelId: string;
  localModel: string;
  localServerUrl: string;
  localServerModel: string;
  agenticMaxIterations: number;
  queryMode: "query" | "ask" | "agent";
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
  const llmProviderRaw = (c.get<string>("llmProvider") || "").trim();
  const llmProvider =
    llmProviderRaw === "copilot"
      ? ("copilot" as const)
      : llmProviderRaw === "local"
        ? ("local" as const)
        : llmProviderRaw === "local-server"
          ? ("local-server" as const)
          : ("bedrock" as const);
  const awsProfile = (c.get<string>("awsProfile") || "").trim() || undefined;
  const bedrockModelId =
    (c.get<string>("bedrockModelId") || "").trim() ||
    "us.anthropic.claude-sonnet-4-20250514-v1:0";
  const localModel =
    (c.get<string>("localModel") || "").trim() || "llama-3-groq-8b-tool-use";
  const localServerUrl =
    (c.get<string>("localServerUrl") || "").trim() ||
    "http://localhost:11434/v1";
  const localServerModel =
    (c.get<string>("localServerModel") || "").trim() || "llama3.1";
  const rawMaxIter = c.get<number>("agenticMaxIterations");
  const agenticMaxIterations =
    typeof rawMaxIter === "number" && Number.isFinite(rawMaxIter)
      ? Math.min(20, Math.max(1, Math.floor(rawMaxIter)))
      : 8;
  const rawMode = (c.get<string>("queryMode") || "").trim();
  const queryMode =
    rawMode === "query" || rawMode === "ask" ? rawMode : ("agent" as const);

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
    localModel,
    localServerUrl,
    localServerModel,
    agenticMaxIterations,
    queryMode,
  };
}

export function resolveCredentials(
  profile?: string,
): AwsCredentialIdentityProvider {
  return profile ? fromIni({ profile }) : fromNodeProviderChain();
}
