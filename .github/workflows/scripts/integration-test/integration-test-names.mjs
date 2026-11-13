// @ts-check
/**
 * Names of the integration test stacks and functions.
 *
 * Each pull request gets its own stack. With one shared stack per runtime,
 * runs from different branches replaced each other's template, so most
 * deploys went through a full CloudFormation update (140-290s) instead of a
 * direct code update (30-60s). They also had to wait for each other.
 * Function names are unique per account, so each pull request stack needs
 * its own function names too. cleanup-pr-stacks.mjs matches these stack
 * names.
 */

/** @typedef {Record<string, string | undefined>} Env */

/**
 * The pull request this run tests, or undefined outside a pull request.
 * Both pull_request and pull_request_target runs (label changes) count.
 * @param {Env} env
 * @returns {string | undefined}
 */
export function pullRequestNumber(env) {
  if (!env.GITHUB_ACTIONS) return undefined;
  const eventName = env.GITHUB_EVENT_NAME;
  if (eventName !== "pull_request" && eventName !== "pull_request_target") {
    return undefined;
  }
  if (!env.GITHUB_EVENT_NUMBER) {
    throw new Error("Could not find GITHUB_EVENT_NUMBER environment variable");
  }
  return env.GITHUB_EVENT_NUMBER;
}

/**
 * @param {string} runtime such as "24.x"
 * @param {Env} env
 */
export function samStackName(runtime, env) {
  const runtimeId = runtime.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  const number = pullRequestNumber(env);
  const suffix = number ? `-pr-${number}` : "";
  return `aws-durable-execution-sdk-js-integ-${runtimeId}${suffix}`;
}

/**
 * The function name of one example, before any capacity provider suffix.
 * @param {object} options
 * @param {string} options.exampleName
 * @param {string} options.runtime such as "24.x"
 * @param {boolean} options.capacityProviderOnly
 * @param {Env} options.env
 */
export function baseFunctionName({
  exampleName,
  runtime,
  capacityProviderOnly,
  env,
}) {
  const name = exampleName.replace(/\s/g, "");
  const lambdaRuntime = runtime.replace(".", "");
  if (!env.GITHUB_ACTIONS) return `${name}-${lambdaRuntime}-NodeJS-Local`;

  // The runtime comes first, since the log scrubber cleans logs by the
  // NodeJS- suffix.
  const baseName = `${name}-${lambdaRuntime}-NodeJS`;
  if (capacityProviderOnly) {
    // Capacity provider functions have their own per pull request names,
    // for pull_request runs only.
    if (env.GITHUB_EVENT_NAME !== "pull_request") return baseName;
    if (!env.GITHUB_EVENT_NUMBER) {
      throw new Error(
        "Could not find GITHUB_EVENT_NUMBER environment variable",
      );
    }
    return `${baseName}-PR-${env.GITHUB_EVENT_NUMBER}`;
  }
  const number = pullRequestNumber(env);
  return number ? `${baseName}-PR-${number}` : baseName;
}
