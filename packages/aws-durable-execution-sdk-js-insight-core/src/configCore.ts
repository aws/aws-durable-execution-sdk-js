/**
 * Host-free configuration: the shape of Workflow Insight's settings, the
 * normalization rules (defaults, coercion, clamping), and credential
 * resolution.
 *
 * Deliberately contains no `vscode` import so that every host can share one
 * definition of what a setting means. The VS Code layer adds `readConfig` on
 * top (config.ts); the desktop app reads the same keys from its own
 * `insight-settings.json`. Keeping normalization here is what stops the two
 * hosts from drifting on defaults.
 */
import { fromIni, fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { isDestinationType, type DestinationType } from "./schema";

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

/** Settings namespace, shared by every host's persistence layer. */
export const SECTION = "workflowInsight";

/**
 * Abstracts where config values come from so the same normalization logic runs
 * no matter which host supplied the values: VS Code's persisted settings
 * (`readConfig` in config.ts), the desktop app's `insight-settings.json`, or
 * the unsaved values coming straight from the Settings webview
 * ({@link configFromWireSettings}, used by "Test connection" before anything is
 * written).
 */
export interface ConfigSource {
  getString(key: string): string | undefined;
  getBool(key: string): boolean | undefined;
  getNumber(key: string): number | undefined;
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

export function normalizeConfig(src: ConfigSource): InsightConfig {
  const region =
    (src.getString("region") || "").trim() ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "us-east-1";
  const logGroupNames = (src.getString("logGroupName") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // An unrecognized value falls back to the default rather than throwing, which is
  // what the extension needs: its setting comes from a dropdown, so a bad value is
  // not a case a user can reach. A host whose configuration is environment-only
  // CAN reach it, so `isDestinationType` is exported for callers that must warn --
  // this function must not become the place that decides how to report it.
  const raw = (src.getString("destinationType") || "").trim();
  const destinationType: DestinationType = isDestinationType(raw)
    ? raw
    : "cloudwatch-logs-exporter";
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
