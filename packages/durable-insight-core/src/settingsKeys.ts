/**
 * The settings keys Workflow Insight understands, shared by every host.
 *
 * The VS Code extension gets its schema from `contributes.configuration` in
 * package.json; the desktop app has no manifest, so it needs the same list to
 * know which keys to accept from the renderer and how to coerce them. Declaring
 * it once here — with settingsKeys.test.ts asserting it still matches the
 * manifest exactly — is what keeps the two hosts from drifting apart as
 * settings are added.
 *
 * Treat this as an allowlist, not a hint: a host should refuse keys outside it
 * rather than persisting whatever the renderer happened to send.
 */

/** Every recognized setting key, unprefixed (no `workflowInsight.`). */
export const SETTING_KEYS = [
  "region",
  "logGroupName",
  "destinationType",
  "sqsQueueUrl",
  "sqsDeleteAfterRead",
  "dynamodbTableName",
  "auroraResourceArn",
  "auroraSecretArn",
  "auroraDatabase",
  "auroraTable",
  "redshiftWorkgroupName",
  "redshiftClusterIdentifier",
  "redshiftDbUser",
  "redshiftSecretArn",
  "redshiftDatabase",
  "redshiftTable",
  "redshiftSchema",
  "opensearchEndpoint",
  "opensearchIndex",
  "athenaDatabase",
  "athenaTable",
  "athenaWorkgroup",
  "athenaOutputLocation",
  "athenaS3Location",
  "awsProfile",
  "llmProvider",
  "bedrockModelId",
  "localServerUrl",
  "localServerModel",
  "localModel",
  "agenticMaxIterations",
  "queryMode",
  "aiDisclosureAcceptedVersion",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

/** Keys the schema types as boolean; the renderer sends them as "true"/"false". */
export const BOOLEAN_SETTING_KEYS: readonly SettingKey[] = [
  "sqsDeleteAfterRead",
];

/** Keys the schema types as number; invalid input must fall back to the default. */
export const NUMBER_SETTING_KEYS: readonly SettingKey[] = [
  "agenticMaxIterations",
];

const KEY_SET: ReadonlySet<string> = new Set(SETTING_KEYS);

/** Whether `key` is a setting this project recognizes. */
export function isSettingKey(key: string): key is SettingKey {
  return KEY_SET.has(key);
}
