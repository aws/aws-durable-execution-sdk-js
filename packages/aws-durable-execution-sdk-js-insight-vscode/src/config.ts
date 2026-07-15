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
  redshiftWorkgroupName: string;
  redshiftClusterIdentifier: string;
  redshiftDbUser: string;
  redshiftSecretArn: string;
  redshiftDatabase: string;
  redshiftTable: string;
  redshiftSchema: string;
  opensearchEndpoint: string;
  opensearchIndex: string;
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
  aiDisclosureAcceptedVersion: string;
}

const SECTION = "workflowInsight";

/**
 * Abstracts where config values come from so the same normalization logic can
 * run against either the persisted VS Code settings ({@link readConfig}) or the
 * unsaved values coming from the Settings webview ({@link configFromWireSettings},
 * used by the "Test connection" button before anything is written).
 */
interface ConfigSource {
  getString(key: string): string | undefined;
  getBool(key: string): boolean | undefined;
  getNumber(key: string): number | undefined;
}

export function readConfig(): InsightConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  return normalizeConfig({
    getString: (k) => c.get<string>(k),
    getBool: (k) => c.get<boolean>(k),
    getNumber: (k) => c.get<number>(k),
  });
}

/**
 * Builds an {@link InsightConfig} from the webview's all-string settings payload
 * without persisting it. Lets the "Test connection" action validate exactly what
 * the user currently has typed in the modal (which may differ from what's saved).
 */
export function configFromWireSettings(
  settings: Record<string, string>,
): InsightConfig {
  const has = (k: string): boolean =>
    Object.prototype.hasOwnProperty.call(settings, k);
  return normalizeConfig({
    getString: (k) => (has(k) ? settings[k] : undefined),
    getBool: (k) => (has(k) ? settings[k] === "true" : undefined),
    getNumber: (k) => (has(k) ? Number(settings[k]) : undefined),
  });
}

function normalizeConfig(src: ConfigSource): InsightConfig {
  const region =
    (src.getString("region") || "").trim() ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "us-east-1";
  const logGroupNames = (src.getString("logGroupName") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const raw = (src.getString("destinationType") || "").trim();
  const destinationType =
    raw === "lambda-log-exporter"
      ? ("lambda-log-exporter" as const)
      : raw === "dynamodb"
        ? ("dynamodb" as const)
        : raw === "aurora"
          ? ("aurora" as const)
          : raw === "redshift"
            ? ("redshift" as const)
            : raw === "opensearch"
              ? ("opensearch" as const)
              : raw === "sqs"
                ? ("sqs" as const)
                : raw === "s3"
                  ? ("s3" as const)
                  : ("cloudwatch-logs-exporter" as const);
  const dynamodbTableName = (src.getString("dynamodbTableName") || "").trim();
  const auroraResourceArn = (src.getString("auroraResourceArn") || "").trim();
  const auroraSecretArn = (src.getString("auroraSecretArn") || "").trim();
  const auroraDatabase =
    (src.getString("auroraDatabase") || "").trim() || "postgres";
  const auroraTable =
    (src.getString("auroraTable") || "").trim() || "workflow_insight";
  const redshiftWorkgroupName = (
    src.getString("redshiftWorkgroupName") || ""
  ).trim();
  const redshiftClusterIdentifier = (
    src.getString("redshiftClusterIdentifier") || ""
  ).trim();
  const redshiftDbUser = (src.getString("redshiftDbUser") || "").trim();
  const redshiftSecretArn = (src.getString("redshiftSecretArn") || "").trim();
  const redshiftDatabase =
    (src.getString("redshiftDatabase") || "").trim() || "dev";
  const redshiftTable =
    (src.getString("redshiftTable") || "").trim() || "workflow_insight";
  const redshiftSchema =
    (src.getString("redshiftSchema") || "").trim() || "public";
  const opensearchEndpoint = (src.getString("opensearchEndpoint") || "").trim();
  const opensearchIndex =
    (src.getString("opensearchIndex") || "").trim() || "workflow-insight";
  const sqsQueueUrl = (src.getString("sqsQueueUrl") || "").trim();
  const sqsDeleteAfterRead = src.getBool("sqsDeleteAfterRead") ?? false;
  const athenaDatabase = (src.getString("athenaDatabase") || "").trim();
  const athenaTable =
    (src.getString("athenaTable") || "").trim() || "workflow_insight";
  const athenaWorkgroup = (src.getString("athenaWorkgroup") || "").trim();
  const athenaOutputLocation = (
    src.getString("athenaOutputLocation") || ""
  ).trim();
  const athenaS3Location = (src.getString("athenaS3Location") || "").trim();
  const llmProviderRaw = (src.getString("llmProvider") || "").trim();
  const llmProvider =
    llmProviderRaw === "copilot"
      ? ("copilot" as const)
      : llmProviderRaw === "local"
        ? ("local" as const)
        : llmProviderRaw === "local-server"
          ? ("local-server" as const)
          : ("bedrock" as const);
  const awsProfile = (src.getString("awsProfile") || "").trim() || undefined;
  const bedrockModelId =
    (src.getString("bedrockModelId") || "").trim() ||
    "us.anthropic.claude-sonnet-5";
  const localModel =
    (src.getString("localModel") || "").trim() || "llama-3-groq-8b-tool-use";
  const localServerUrl =
    (src.getString("localServerUrl") || "").trim() ||
    "http://localhost:11434/v1";
  const localServerModel =
    (src.getString("localServerModel") || "").trim() || "llama3.1";
  const rawMaxIter = src.getNumber("agenticMaxIterations");
  const agenticMaxIterations =
    typeof rawMaxIter === "number" && Number.isFinite(rawMaxIter)
      ? Math.min(20, Math.max(1, Math.floor(rawMaxIter)))
      : 8;
  const rawMode = (src.getString("queryMode") || "").trim();
  const queryMode =
    rawMode === "query" || rawMode === "ask" ? rawMode : ("agent" as const);
  const aiDisclosureAcceptedVersion = (
    src.getString("aiDisclosureAcceptedVersion") || ""
  ).trim();

  return {
    region,
    logGroupNames,
    destinationType,
    dynamodbTableName,
    auroraResourceArn,
    auroraSecretArn,
    auroraDatabase,
    auroraTable,
    redshiftWorkgroupName,
    redshiftClusterIdentifier,
    redshiftDbUser,
    redshiftSecretArn,
    redshiftDatabase,
    redshiftTable,
    redshiftSchema,
    opensearchEndpoint,
    opensearchIndex,
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
    aiDisclosureAcceptedVersion,
  };
}

export function resolveCredentials(
  profile?: string,
): AwsCredentialIdentityProvider {
  return profile ? fromIni({ profile }) : fromNodeProviderChain();
}
