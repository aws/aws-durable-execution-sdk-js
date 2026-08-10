/**
 * Reads this host's configuration from the environment.
 *
 * The MCP host is configured entirely by `DURABLE_INSIGHT_`-prefixed
 * environment variables (see envKeys.ts). This module gathers the set ones into
 * the same all-string map shape the VS Code Settings webview produces, then
 * hands it to core's {@link configFromWireSettings} so defaults, coercion, and
 * normalization are applied in exactly one place — this host never reimplements
 * them.
 */
import {
  configFromWireSettings,
  type InsightConfig,
  DESTINATION_TYPES,
  isDestinationType,
} from "@aws/durable-execution-sdk-js-insight-core";
import {
  envVarFor,
  MCP_SETTING_KEYS,
  MCP_EXCLUDED_SETTING_KEYS,
} from "./envKeys";

export interface ReadConfigResult {
  config: InsightConfig;
  warnings: string[];
}

/**
 * Builds an {@link InsightConfig} from `env`.
 *
 * - Reads every {@link MCP_SETTING_KEYS} key from its `DURABLE_INSIGHT_*`
 *   variable and passes the set ones to core's normalizer.
 * - Applies the standard AWS fallbacks: `AWS_REGION` for region and
 *   `AWS_PROFILE` for the profile, so customers who already export the standard
 *   variables don't have to duplicate them. The prefixed form wins when both
 *   are set.
 * - Never throws. A stray excluded variable (e.g. copied from VS Code settings)
 *   produces a warning, not a failure — the model comes from the agent, so
 *   there is nothing to apply. Missing destination config is likewise NOT an
 *   error here: diagnosing it belongs to the `test_destination` tool, because a
 *   server that refuses to start surfaces in an MCP client as an unexplained
 *   failure, whereas one that starts can tell the agent exactly what is wrong.
 */
export function readConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ReadConfigResult {
  const warnings: string[] = [];
  const wire: Record<string, string> = {};

  for (const key of MCP_SETTING_KEYS) {
    const value = env[envVarFor(key)];
    if (value !== undefined) {
      wire[key] = value;
    }
  }

  // Standard AWS fallbacks. The prefixed form already collected above wins;
  // only fill in from the standard variable when the prefixed one is unset.
  if (wire["region"] === undefined) {
    // Both, and in this order — `normalizeConfig` honors AWS_DEFAULT_REGION too, so
    // reading only AWS_REGION here made this the narrower of two overlapping
    // fallbacks: a user with only AWS_DEFAULT_REGION set got core's default region
    // in the config this function returns, while core would have resolved it.
    const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION;
    if (region !== undefined) wire["region"] = region;
  }
  if (wire["awsProfile"] === undefined && env.AWS_PROFILE !== undefined) {
    wire["awsProfile"] = env.AWS_PROFILE;
  }

  // Warn (don't apply, don't throw) for any excluded variable that is present:
  // this host takes its model from the agent, so there is nothing to configure.
  for (const key of MCP_EXCLUDED_SETTING_KEYS) {
    const varName = envVarFor(key);
    if (env[varName] !== undefined) {
      warnings.push(
        `${varName} is set but ignored: this host takes its model from the agent, ` +
          `so provider/model settings do not apply.`,
      );
    }
  }

  // An unrecognized DESTINATION_TYPE is the expected failure mode for a host
  // configured only by environment variables, and it is silent: `normalizeConfig`
  // falls back to "cloudwatch-logs-exporter", so `DESTINATION_TYPE=dynamo` yields a
  // server that reports DURABLE_INSIGHT_LOG_GROUP_NAME as missing to a user who set
  // every DynamoDB variable correctly. The default is right for the extension, where
  // the value comes from a dropdown and cannot be misspelled; it is a trap here.
  //
  // A warning rather than a throw, for the same reason missing destination config is
  // a warning: a server that refuses to start appears in an MCP client as an
  // unexplained failure, while one that starts can say what is wrong.
  const rawDestination = wire["destinationType"];
  if (
    rawDestination !== undefined &&
    !isDestinationType(rawDestination.trim())
  ) {
    warnings.push(
      `${envVarFor("destinationType")}="${rawDestination}" is not a recognized ` +
        `destination type, so it was ignored and the default ` +
        `"cloudwatch-logs-exporter" is in use — which is why a required variable ` +
        `for that destination may be reported as missing. Valid values: ` +
        `${DESTINATION_TYPES.join(", ")}.`,
    );
  }

  return { config: configFromWireSettings(wire), warnings };
}

/**
 * Given a normalized config, the `DURABLE_INSIGHT_*` variable NAMES a query
 * against `cfg.destinationType` needs but which are absent.
 *
 * The notion of "required" is taken from core's destinationTest.ts (its
 * `missing.push` checks) so this host and the UI agree on what a destination
 * needs. Note two consequences of trusting that source:
 *   - Fields core defaults to a non-empty value (auroraDatabase="postgres",
 *     redshiftDatabase="dev") can never be blank in a normalized config, so
 *     they are never reported.
 *   - Redshift requires a workgroup OR cluster but does NOT require a secret ARN
 *     (destinationTest.ts runs its SELECT 1 with secretArn optional). This
 *     differs from an earlier spec that listed redshiftSecretArn as required;
 *     we follow destinationTest.ts.
 */
export function missingRequiredEnvVars(cfg: InsightConfig): string[] {
  const missing: string[] = [];
  const need = (key: string) => missing.push(envVarFor(key));

  switch (cfg.destinationType) {
    case "cloudwatch-logs-exporter":
    case "lambda-log-exporter":
      if (cfg.logGroupNames.length === 0) need("logGroupName");
      break;
    case "dynamodb":
      if (!cfg.dynamodbTableName) need("dynamodbTableName");
      break;
    case "s3":
      if (!cfg.athenaDatabase) need("athenaDatabase");
      // Querying Athena needs somewhere to put RESULTS: either a workgroup that
      // has an output location configured, or an explicit one. This mirrors
      // destinationTest.ts, which treats "no workgroup and no output location"
      // as the incomplete case.
      //
      // Note this is deliberately NOT athenaS3Location. That is the SOURCE data
      // location, required only to CREATE the table -- something this host never
      // does. Requiring it here would demand a variable the customer does not
      // need, while leaving the one they do need unreported.
      if (!cfg.athenaWorkgroup && !cfg.athenaOutputLocation) {
        need("athenaWorkgroup");
        need("athenaOutputLocation");
      }
      break;
    case "aurora":
      if (!cfg.auroraResourceArn) need("auroraResourceArn");
      if (!cfg.auroraSecretArn) need("auroraSecretArn");
      break;
    case "redshift":
      // Serverless (workgroup) or provisioned (cluster) — need exactly one.
      // Report both names when neither is set.
      if (!cfg.redshiftWorkgroupName && !cfg.redshiftClusterIdentifier) {
        need("redshiftWorkgroupName");
        need("redshiftClusterIdentifier");
      }
      break;
    case "opensearch":
      if (!cfg.opensearchEndpoint) need("opensearchEndpoint");
      break;
    case "sqs":
      if (!cfg.sqsQueueUrl) need("sqsQueueUrl");
      break;
  }

  return missing;
}
