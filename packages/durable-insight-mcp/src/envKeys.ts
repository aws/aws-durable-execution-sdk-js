/**
 * The environment-variable naming scheme for the MCP host, and the split
 * between the setting keys this host accepts and the ones it deliberately does
 * not.
 *
 * This host is configured by environment variables only — no settings file, no
 * mutable config. Every knob is a `DURABLE_INSIGHT_`-prefixed variable derived
 * mechanically from the shared {@link SETTING_KEYS} constant, so the two lists
 * below cannot drift from the extension's manifest (envKeys.test.ts enforces
 * this as a contract).
 */
import { SETTING_KEYS } from "durable-insight-core";

/**
 * The environment variable name for a setting key.
 *
 * Convention: `DURABLE_INSIGHT_` + SCREAMING_SNAKE of the key. The key is
 * lower-camelCase, so we insert `_` before each uppercase letter and uppercase
 * the whole string. Examples:
 *   athenaDatabase   -> DURABLE_INSIGHT_ATHENA_DATABASE
 *   athenaS3Location -> DURABLE_INSIGHT_ATHENA_S3_LOCATION
 *   sqsQueueUrl      -> DURABLE_INSIGHT_SQS_QUEUE_URL
 */
export function envVarFor(settingKey: string): string {
  const screamingSnake = settingKey.replace(/([A-Z])/g, "_$1").toUpperCase();
  return `DURABLE_INSIGHT_${screamingSnake}`;
}

/**
 * Setting keys this host does NOT accept.
 *
 * The MCP host takes its model from the AGENT that drives it: the agent already
 * has an LLM, so there is no provider for this host to configure, no local
 * model to run, no agent-loop iteration budget of its own, no query-mode
 * default, and no AI-usage consent to record (the agent's host owns that
 * relationship with the user). Listing these explicitly — rather than deriving
 * them — makes the exclusion intentional and reviewable; the partition test
 * guarantees they are all real setting keys and that nothing else leaks in.
 */
export const MCP_EXCLUDED_SETTING_KEYS: readonly string[] = [
  "llmProvider", // agent supplies the model — no provider to choose
  "bedrockModelId", // "
  "localModel", // no on-device model run by this host
  "localServerUrl", // no local-server provider configured here
  "localServerModel", // "
  "agenticMaxIterations", // the agent owns its own loop/iteration budget
  "queryMode", // the agent decides how to query; no persisted default
  "aiDisclosureAcceptedVersion", // consent belongs to the agent's host
];

const EXCLUDED_SET: ReadonlySet<string> = new Set(MCP_EXCLUDED_SETTING_KEYS);

/**
 * The setting keys this host accepts: {@link SETTING_KEYS} minus the excluded
 * eight. Computed from the real constant so it can never drift from the
 * extension's manifest.
 */
export const MCP_SETTING_KEYS: readonly string[] = SETTING_KEYS.filter(
  (k) => !EXCLUDED_SET.has(k),
);
