/**
 * The environment-variable naming scheme for the MCP host, and the split
 * between the setting keys this host accepts and the ones it deliberately does
 * not.
 *
 * This host is configured by environment variables only — no settings file, no
 * mutable config. Every knob is a `DURABLE_TELEMETRY_`-prefixed variable derived
 * mechanically from the shared {@link SETTING_KEYS} constant, so the two lists
 * below cannot drift from the extension's manifest (envKeys.test.ts enforces
 * this as a contract).
 */
import { SETTING_KEYS } from "@aws/durable-execution-sdk-js-telemetry-core";

/**
 * The environment variable name for a setting key.
 *
 * Convention: `DURABLE_TELEMETRY_` + SCREAMING_SNAKE of the key. The key is
 * lower-camelCase, so we insert `_` before each uppercase letter and uppercase
 * the whole string. Examples:
 *   athenaDatabase   -> DURABLE_TELEMETRY_ATHENA_DATABASE
 *   athenaS3Location -> DURABLE_TELEMETRY_ATHENA_S3_LOCATION
 *   sqsQueueUrl      -> DURABLE_TELEMETRY_SQS_QUEUE_URL
 */
export function envVarFor(settingKey: string): string {
  const screamingSnake = settingKey.replace(/([A-Z])/g, "_$1").toUpperCase();
  return `DURABLE_TELEMETRY_${screamingSnake}`;
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

/**
 * Set to `true` in the server's `env` block to confirm, permanently, that
 * giving this server read-only credentials is the user's responsibility (see
 * writeAccessGate.ts). It is not a setting key: the extension and desktop app
 * only show a warning, so they have no such setting.
 */
export const ACCEPT_WRITE_ACCESS_ENV_VAR =
  "DURABLE_TELEMETRY_ACCEPT_WRITE_ACCESS";

/**
 * Set to `true` to turn off the local execution viewer (executionViewer.ts):
 * no port is opened and results carry no `viewerLink`.
 */
export const VIEWER_DISABLED_ENV_VAR = "DURABLE_TELEMETRY_VIEWER_DISABLED";

/**
 * Loopback port for the execution viewer. Unset or 0 picks a free port each
 * session. A fixed port keeps the address the same across sessions. Links
 * from an earlier session still stop working, because each session makes a
 * new token.
 */
export const VIEWER_PORT_ENV_VAR = "DURABLE_TELEMETRY_VIEWER_PORT";

/**
 * `DURABLE_TELEMETRY_*` variables this host reads that are not derived from
 * {@link SETTING_KEYS}.
 */
export const MCP_HOST_ONLY_ENV_VARS: readonly string[] = [
  ACCEPT_WRITE_ACCESS_ENV_VAR,
  VIEWER_DISABLED_ENV_VAR,
  VIEWER_PORT_ENV_VAR,
];
