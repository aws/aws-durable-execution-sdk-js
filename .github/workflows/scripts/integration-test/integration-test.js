// @ts-check

import { execSync } from "child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ArgumentParser } from "argparse";

import {
  LambdaClient,
  DeleteFunctionCommand,
  ResourceNotFoundException as ResourceNotFoundExceptionLambda,
} from "@aws-sdk/client-lambda";
import {
  CloudWatchLogsClient,
  DeleteLogGroupCommand,
  ResourceNotFoundException as ResourceNotFoundExceptionCloudwatch,
} from "@aws-sdk/client-cloudwatch-logs";

import dotenv from "dotenv";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({
  path: join(__dirname, "../../../../.env"),
});

// Colors for output
const COLORS = {
  RED: "\x1b[0;31m",
  GREEN: "\x1b[0;32m",
  YELLOW: "\x1b[1;33m",
  BLUE: "\x1b[0;34m",
  NC: "\x1b[0m", // No Color
};

const log = {
  info: (/** @type {string} */ msg) =>
    console.log(`${COLORS.BLUE}[INFO]${COLORS.NC} ${msg}`),
  success: (/** @type {string} */ msg) =>
    console.log(`${COLORS.GREEN}[SUCCESS]${COLORS.NC} ${msg}`),
  warning: (/** @type {string} */ msg) =>
    console.log(`${COLORS.YELLOW}[WARNING]${COLORS.NC} ${msg}`),
  error: (/** @type {string} */ msg) =>
    console.error(`${COLORS.RED}[ERROR]${COLORS.NC} ${msg}`),
};

// Configuration
const CONFIG = {
  AWS_REGION: process.env.AWS_REGION || "us-east-1",
  LAMBDA_ENDPOINT: process.env.LAMBDA_ENDPOINT,
  TEST_ACCOUNT_ID: process.env.TEST_ACCOUNT_ID,
  TEST_CAPACITY_PROVIDER_ARN: process.env.TEST_CAPACITY_PROVIDER_ARN,
  TEST_LAMBDA_EXECUTION_ROLE_ARN: process.env.TEST_LAMBDA_EXECUTION_ROLE_ARN,
  PROJECT_ROOT: join(__dirname, "../../../.."),
  // Package directory paths
  SDK_PACKAGE_PATH: join(
    __dirname,
    "../../../../packages/aws-durable-execution-sdk-js",
  ),
  EXAMPLES_PACKAGE_PATH: join(
    __dirname,
    "../../../../packages/aws-durable-execution-sdk-js-examples",
  ),
};

const CAPACITY_PROVIDER_FUNCTION_SUFFIX = "-capacity-provider";

function shellQuote(/** @type {string} */ value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

class IntegrationTestRunner {
  /**
   * @param {Object} options
   * @param {boolean} [options.cleanupOnExit]
   * @param {string} options.runtime
   */
  constructor(options) {
    this.cleanupOnExit = options.cleanupOnExit !== false;
    this.runtime = options.runtime;
    this.isGitHubActions = !!process.env.GITHUB_ACTIONS;
    /** @type {import('@aws-sdk/client-lambda').LambdaClient | null} */
    this.lambdaClient = null;
    /** @type {import('@aws/durable-execution-sdk-js-examples/catalog').default | null} */
    this.examplesCatalog = null;

    // Set up cleanup handler
    if (this.cleanupOnExit) {
      process.on("SIGINT", () => {
        process.exit(130);
      });
      process.on("SIGTERM", () => {
        process.exit(143);
      });
    }
  }

  initializeLambdaClient() {
    if (!this.lambdaClient) {
      /** @type {import('@aws-sdk/client-lambda').LambdaClientConfig} */
      const clientConfig = {
        region: CONFIG.AWS_REGION,
      };

      // Add custom endpoint if specified
      if (CONFIG.LAMBDA_ENDPOINT) {
        clientConfig.endpoint = CONFIG.LAMBDA_ENDPOINT;
      }

      this.lambdaClient = new LambdaClient(clientConfig);
      log.info(`Lambda client initialized for region: ${CONFIG.AWS_REGION}`);
      if (CONFIG.LAMBDA_ENDPOINT) {
        log.info(`Using custom endpoint: ${CONFIG.LAMBDA_ENDPOINT}`);
      }
    }
    return this.lambdaClient;
  }

  /**
   * @param {string} command
   * @param {Object} options
   * @param {boolean} [options.silent]
   * @param {string} [options.cwd]
   * @param {Object} [options.env]
   */
  execCommand(command, options = {}) {
    /** @type {import('child_process').ExecSyncOptions} */
    const execOptions = {
      encoding: "utf8",
      stdio: options.silent ? "pipe" : "inherit",
      cwd: options.cwd || CONFIG.PROJECT_ROOT,
    };

    if (options.env) {
      /** @type {NodeJS.ProcessEnv} */
      const envVars = {};
      Object.assign(envVars, process.env, options.env);
      execOptions.env = envVars;
    }

    const result = execSync(command, execOptions);
    return { output: result };
  }

  /**
   * @param {string} command
   * @param {Object} options
   * @param {boolean} [options.silent]
   * @param {string} [options.cwd]
   * @param {Object} [options.env]
   * @param {number} [maxAttempts]
   */
  async execCommandWithRetry(command, options = {}, maxAttempts = 5) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return this.execCommand(command, options);
      } catch (error) {
        if (attempt === maxAttempts) {
          throw error;
        }

        const delayMs = Math.min(15000 * attempt, 60000);
        log.warning(
          `Command failed; retrying attempt ${attempt + 1}/${maxAttempts} in ${delayMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error("Max command retry attempts exceeded");
  }

  getRuntimeId() {
    return this.runtime.replace(/[^A-Za-z0-9]/g, "");
  }

  getLegacyTestSecretEnv() {
    return Object.fromEntries(
      Object.entries({
        AWS_ACCOUNT_ID: CONFIG.TEST_ACCOUNT_ID,
        CAPACITY_PROVIDER_ARN: CONFIG.TEST_CAPACITY_PROVIDER_ARN,
        LAMBDA_EXECUTION_ROLE_ARN: CONFIG.TEST_LAMBDA_EXECUTION_ROLE_ARN,
      }).filter(([, value]) => value !== undefined),
    );
  }

  getSamStackName() {
    const runtimeId = this.getRuntimeId().toLowerCase();
    return `aws-durable-execution-sdk-js-integ-${runtimeId}`;
  }

  getLegacyPRSamStackName() {
    if (!process.env.GITHUB_EVENT_NUMBER) {
      throw new Error("Could not find GITHUB_EVENT_NUMBER environment variable");
    }
    const runtimeId = this.getRuntimeId().toLowerCase();
    return (
      `aws-durable-execution-sdk-js-integ-${runtimeId}-pr-` +
      process.env.GITHUB_EVENT_NUMBER
    );
  }

  samStackExists(/** @type {string | undefined} */ stackName = undefined) {
    const resolvedStackName = stackName ?? this.getSamStackName();
    try {
      this.execCommand(
        `aws cloudformation describe-stacks --stack-name ${shellQuote(resolvedStackName)} --region ${shellQuote(CONFIG.AWS_REGION)}`,
        { silent: true },
      );
      return true;
    } catch {
      return false;
    }
  }

  async getExamplesCatalog() {
    if (!this.examplesCatalog) {
      const imported = await import(
        "@aws/durable-execution-sdk-js-examples/catalog"
      );
      this.examplesCatalog = imported.default;
    }

    return this.examplesCatalog;
  }

  // Get integration examples from catalog
  async getIntegrationExamples() {
    log.info("Getting integration examples...");
    const examplesCatalog = await this.getExamplesCatalog();
    return examplesCatalog.filter(
      (example) =>
        !example.localOnly &&
        !(
          example.excludeRuntimes &&
          example.excludeRuntimes.includes(this.runtime)
        ),
    );
  }

  /**
   *
   * @param {{ capacityProviderOnly: boolean, prScopedFunctionNames?: boolean }} options
   * @returns
   */
  async getFunctionNameMap(options) {
    const examples = await this.getIntegrationExamples();
    /** @type {Record<string, {functionName: string, qualifier: string}>} */
    const functionNameMap = {};

    // Get runtime suffix from argument or environment variable
    const lambdaRuntime = this.runtime.replace(".", "");

    for (const example of examples) {
      const exampleName = example.name;
      const exampleHandler = example.handler;

      // Build base function name with runtime suffix
      let baseFunctionName;
      if (this.isGitHubActions) {
        // Functions are named with the runtime first since the log scrubber cleans logs by the NodeJS- suffix
        const baseName =
          exampleName.replace(/\s/g, "") + `-${lambdaRuntime}-NodeJS`;
        if (
          (options.capacityProviderOnly || options.prScopedFunctionNames) &&
          process.env.GITHUB_EVENT_NAME === "pull_request"
        ) {
          if (!process.env.GITHUB_EVENT_NUMBER) {
            throw new Error(
              "Could not find GITHUB_EVENT_NUMBER environment variable",
            );
          }
          baseFunctionName = `${baseName}-PR-${process.env.GITHUB_EVENT_NUMBER}`;
        } else {
          baseFunctionName = baseName;
        }
      } else {
        const name =
          exampleName.replace(/\s/g, "") + `-${lambdaRuntime}-NodeJS-Local`;
        baseFunctionName = name;
      }

      const handlerFile = exampleHandler.replace(/\.handler$/, "");

      if (options.capacityProviderOnly) {
        if (example.capacityProviderConfig) {
          functionNameMap[
            `${handlerFile}${CAPACITY_PROVIDER_FUNCTION_SUFFIX}`
          ] = {
            functionName: `${baseFunctionName}-CapacityProvider`,
            qualifier: "$LATEST.PUBLISHED",
          };
        }
      } else {
        functionNameMap[handlerFile] = {
          functionName: baseFunctionName,
          qualifier: "$LATEST",
        };
      }
    }

    return functionNameMap;
  }

  /**
   * Deploy Lambda functions
   * @param {string | undefined} testPattern
   * @param {Object} options
   * @param {boolean} [options.capacityProviderOnly] - Deploy only capacity provider functions
   */
  async deployFunctions(testPattern, options = {}) {
    const { capacityProviderOnly = false } = options;

    log.info("Deploying Lambda functions...");

    if (!CONFIG.TEST_ACCOUNT_ID) {
      throw new Error("Missing required TEST_ACCOUNT_ID for deployment");
    }

    const examples = await this.getIntegrationExamples();
    const examplesDir = CONFIG.EXAMPLES_PACKAGE_PATH;

    const functionNameMap = await this.getFunctionNameMap({
      capacityProviderOnly: capacityProviderOnly,
    });

    if (!capacityProviderOnly) {
      if (testPattern) {
        throw new Error("SAM deployment does not support --test-pattern");
      }

      await this.deployFunctionsWithSam(functionNameMap);

      if (this.isGitHubActions) {
        if (!process.env.GITHUB_OUTPUT) {
          throw new Error("Could not find GITHUB_OUTPUT environment variable");
        }
        appendFileSync(
          process.env.GITHUB_OUTPUT,
          `function-name-map=${JSON.stringify(functionNameMap)}`,
        );
      }

      log.success("Function deployment completed");
      return;
    }

    for (const example of examples) {
      const exampleHandler = example.handler;

      // Extract handler file name from catalog
      const handlerFile = exampleHandler.replace(/\.handler$/, "");

      // Skip if testPattern doesn't match
      if (testPattern && !handlerFile.includes(testPattern)) {
        continue;
      }

      if (capacityProviderOnly && !example.capacityProviderConfig) {
        continue;
      }

      // Package the function once for both deployments (if needed)
      this.execCommand(`npm run package -- "${handlerFile}"`, {
        cwd: examplesDir,
      });

      if (capacityProviderOnly && example.capacityProviderConfig) {
        const capacityProviderKey = `${handlerFile}-capacity-provider`;
        const capacityProviderFunctionName =
          functionNameMap[capacityProviderKey].functionName;
        log.info(
          `Deploying capacity provider function: ${capacityProviderFunctionName} (handler: ${handlerFile})`,
        );

        let capacityDeployCommand = `npm run deploy -- "${handlerFile}" '${capacityProviderFunctionName}' --runtime ${this.runtime} --use-capacity-provider`;
        this.execCommand(capacityDeployCommand, {
          cwd: examplesDir,
          env: this.getLegacyTestSecretEnv(),
        });
        log.success(
          `Deployed capacity provider function: ${capacityProviderFunctionName}`,
        );
      }
    }

    if (this.isGitHubActions) {
      if (!process.env.GITHUB_OUTPUT) {
        throw new Error("Could not find GITHUB_OUTPUT environment variable");
      }
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `function-name-map=${JSON.stringify(functionNameMap)}`,
      );
    }

    log.success("Function deployment completed");
  }

  /**
   * @param {Record<string, {functionName: string, qualifier: string}>} functionNameMap
   */
  async deployFunctionsWithSam(functionNameMap) {
    const examplesDir = CONFIG.EXAMPLES_PACKAGE_PATH;
    const stackName = this.getSamStackName();
    const samDir = join(examplesDir, ".aws-sam");
    const functionNameMapPath = join(
      samDir,
      `function-name-map-${this.getRuntimeId()}.json`,
    );
    const templatePath = join(
      samDir,
      `integration-template-${this.getRuntimeId()}.yml`,
    );

    mkdirSync(samDir, { recursive: true });
    writeFileSync(functionNameMapPath, JSON.stringify(functionNameMap), "utf8");

    this.execCommand("npm run generate-examples", { cwd: examplesDir });

    const templateArgs = [
      "npm run generate-sam-template --",
      `--runtime ${shellQuote(this.runtime)}`,
      `--aws-region ${shellQuote(CONFIG.AWS_REGION)}`,
      "--code-uri ../dist",
      `--function-name-map-file ${shellQuote(functionNameMapPath)}`,
      `--output-template-file ${shellQuote(templatePath)}`,
    ];

    if (CONFIG.TEST_LAMBDA_EXECUTION_ROLE_ARN) {
      templateArgs.push(
        `--lambda-execution-role-arn ${shellQuote(CONFIG.TEST_LAMBDA_EXECUTION_ROLE_ARN)}`,
      );
    }

    if (CONFIG.LAMBDA_ENDPOINT) {
      templateArgs.push(
        `--lambda-endpoint ${shellQuote(CONFIG.LAMBDA_ENDPOINT)}`,
      );
    }

    this.execCommand(templateArgs.join(" "), { cwd: examplesDir });

    if (!this.samStackExists()) {
      log.info(
        `SAM stack ${stackName} does not exist; deleting legacy Lambda deployments before first stack create`,
      );
      await this.cleanupLambdaFunctions(functionNameMap);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    const deployCommand = [
      "sam deploy",
      `--template-file ${shellQuote(templatePath)}`,
      `--stack-name ${shellQuote(stackName)}`,
      `--region ${shellQuote(CONFIG.AWS_REGION)}`,
      "--resolve-s3",
      "--no-confirm-changeset",
      "--no-fail-on-empty-changeset",
      "--capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM",
    ].join(" ");

    log.info(`Deploying SAM stack: ${stackName}`);
    await this.execCommandWithRetry(deployCommand, { cwd: examplesDir });
    log.success(`Deployed SAM stack: ${stackName}`);
  }

  // Run Jest integration tests
  async runJestTests(
    /** @type {string | undefined} */ testPattern,
    /** @type {{ capacityProviderOnly?: boolean }} */ options = {},
  ) {
    const { capacityProviderOnly = false } = options;
    log.info("Running Jest integration tests...");

    const examplesDir = CONFIG.EXAMPLES_PACKAGE_PATH;

    /** @type {Record<string, string>} */
    let functionsWithQualifier;

    if (capacityProviderOnly) {
      // The capacity provider workflow only deploys the -CapacityProvider
      // variants of examples that opt in via capacityProviderConfig. Key those
      // by the example base name (which the test harness resolves) and point
      // them at the deployed capacity provider function.
      //
      // Examples without a capacityProviderConfig are intentionally omitted so
      // the harness skips them. Otherwise this job would invoke the regular
      // functions (which it never deploys — they are owned by the parallel
      // integration-tests workflow), causing a cross-workflow race that
      // surfaced as a flaky ResourceNotFoundException.
      functionsWithQualifier = Object.fromEntries(
        Object.entries(
          await this.getFunctionNameMap({ capacityProviderOnly: true }),
        ).map(([key, { functionName, qualifier }]) => {
          const baseKey = key.endsWith(CAPACITY_PROVIDER_FUNCTION_SUFFIX)
            ? key.slice(0, -CAPACITY_PROVIDER_FUNCTION_SUFFIX.length)
            : key;
          return [baseKey, `${functionName}:${qualifier}`];
        }),
      );
    } else {
      functionsWithQualifier = Object.fromEntries(
        Object.entries(
          await this.getFunctionNameMap({ capacityProviderOnly: false }),
        ).map(([key, { functionName, qualifier }]) => {
          return [key, `${functionName}:${qualifier}`];
        }),
      );
    }

    // Set additional environment variables
    const env = {
      FUNCTION_NAME_MAP: JSON.stringify(functionsWithQualifier),
      LAMBDA_ENDPOINT: CONFIG.LAMBDA_ENDPOINT,
    };

    log.info(`Lambda Endpoint: ${CONFIG.LAMBDA_ENDPOINT}`);

    // Build test command with optional pattern
    let testCommand = "npm run test:integration";
    if (testPattern) {
      testCommand += ` -- ${testPattern}`;
      log.info(`Running tests with pattern: ${testPattern}`);
    }

    this.execCommand(testCommand, {
      cwd: examplesDir,
      env,
    });
    log.success("Jest integration tests passed");
  }

  /**
   * Cleanup deployed functions
   * @param {boolean} capacityProviderOnly
   * @returns
   */
  async cleanup(capacityProviderOnly) {
    const functionNameMap = await this.getFunctionNameMap({
      capacityProviderOnly: capacityProviderOnly,
    });

    if (Object.keys(functionNameMap).length === 0) {
      log.warning("No functions to clean up");
      return;
    }

    log.info("Cleaning up deployed functions and logs...");

    if (!capacityProviderOnly) {
      const stackName = this.getSamStackName();
      if (this.samStackExists()) {
        log.info(`Deleting SAM stack: ${stackName}`);
        this.execCommand(
          `sam delete --stack-name ${shellQuote(stackName)} --region ${shellQuote(CONFIG.AWS_REGION)} --no-prompts`,
        );
        log.success(`Deleted SAM stack: ${stackName}`);
        return;
      }

      log.warning(
        `SAM stack ${stackName} was not found; falling back to legacy Lambda cleanup`,
      );
    }

    await this.cleanupLambdaFunctions(functionNameMap);
  }

  /**
   * @param {Record<string, {functionName: string, qualifier: string}>} functionNameMap
   */
  async cleanupLambdaFunctions(functionNameMap) {
    // Initialize Lambda client for cleanup
    const lambdaClient = this.initializeLambdaClient();

    for (const { functionName } of Object.values(functionNameMap)) {
      log.info(`Deleting function: ${functionName}`);
      const cloudwatchLogsClient = new CloudWatchLogsClient({
        region: CONFIG.AWS_REGION,
      });

      const deleteCommand = new DeleteFunctionCommand({
        FunctionName: functionName,
      });

      try {
        await lambdaClient.send(deleteCommand);
        log.success(`Deleted function: ${functionName}`);
      } catch (error) {
        if (error instanceof ResourceNotFoundExceptionLambda) {
          log.warning(`Function not found: ${functionName}`);
        } else {
          throw error;
        }
      }

      const logGroupName = `/aws/lambda/${functionName}`;
      try {
        await cloudwatchLogsClient.send(
          new DeleteLogGroupCommand({
            logGroupName,
          }),
        );
      } catch (err) {
        if (err instanceof ResourceNotFoundExceptionCloudwatch) {
          log.warning(`Log group not found: ${logGroupName}`);
          continue;
        }
        throw err;
      }

      log.success(`Deleted log group ${logGroupName}`);
    }
  }

  async cleanupLegacyPRTestResources() {
    const stackName = this.getLegacyPRSamStackName();

    if (this.samStackExists(stackName)) {
      log.info(`Deleting legacy PR SAM stack: ${stackName}`);
      this.execCommand(
        `sam delete --stack-name ${shellQuote(stackName)} --region ${shellQuote(CONFIG.AWS_REGION)} --no-prompts`,
      );
      log.success(`Deleted legacy PR SAM stack: ${stackName}`);
      return;
    }

    log.warning(
      `Legacy PR SAM stack ${stackName} was not found; falling back to legacy Lambda cleanup`,
    );
    await this.cleanupLambdaFunctions(
      await this.getFunctionNameMap({
        capacityProviderOnly: false,
        prScopedFunctionNames: true,
      }),
    );
  }

  /**
   * Delete PR integration test SAM stacks older than the supplied age.
   *
   * @param {number} olderThanDays
   */
  async cleanupOldPRTestingStacks(olderThanDays) {
    const stackNamePrefix = `aws-durable-execution-sdk-js-integ-${this.getRuntimeId().toLowerCase()}-pr-`;
    const cutoffMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const deletableStatuses = [
      "CREATE_COMPLETE",
      "CREATE_FAILED",
      "DELETE_FAILED",
      "IMPORT_COMPLETE",
      "IMPORT_ROLLBACK_COMPLETE",
      "ROLLBACK_COMPLETE",
      "UPDATE_COMPLETE",
      "UPDATE_ROLLBACK_COMPLETE",
      "UPDATE_ROLLBACK_FAILED",
    ];

    log.info(
      `Looking for ${stackNamePrefix}* stacks older than ${olderThanDays} days`,
    );

    const { output } = this.execCommand(
      [
        "aws cloudformation list-stacks",
        `--region ${shellQuote(CONFIG.AWS_REGION)}`,
        `--stack-status-filter ${deletableStatuses.join(" ")}`,
        "--output json",
      ].join(" "),
      { silent: true },
    );
    const response = JSON.parse(output);
    const stacks = response.StackSummaries ?? [];

    const oldPRStacks = stacks.filter((/** @type {any} */ stack) => {
      if (!stack.StackName?.startsWith(stackNamePrefix)) {
        return false;
      }

      const lastTouchedAt = Date.parse(
        stack.LastUpdatedTime ?? stack.CreationTime,
      );
      return !Number.isNaN(lastTouchedAt) && lastTouchedAt < cutoffMs;
    });

    if (oldPRStacks.length === 0) {
      log.success("No old PR testing stacks found");
      return;
    }

    for (const stack of oldPRStacks) {
      const lastTouchedTime = stack.LastUpdatedTime ?? stack.CreationTime;
      log.info(
        `Deleting old PR testing stack: ${stack.StackName} (${lastTouchedTime})`,
      );
      this.execCommand(
        `sam delete --stack-name ${shellQuote(stack.StackName)} --region ${shellQuote(CONFIG.AWS_REGION)} --no-prompts`,
      );
      log.success(`Deleted old PR testing stack: ${stack.StackName}`);
    }
  }

  /**
   * @param {Object} options
   * @param {boolean} [options.deployOnly]
   * @param {boolean} [options.testOnly]
   * @param {boolean} [options.cleanupOnly]
   * @param {boolean} [options.cleanupLegacyPRStack]
   * @param {boolean} [options.cleanupOldPRStacks]
   * @param {number} [options.olderThanDays]
   * @param {string} [options.testPattern]
   * @param {boolean} [options.capacityProviderOnly]
   */
  async run(options = {}) {
    const {
      deployOnly = false,
      testOnly = false,
      cleanupOnly = false,
      cleanupLegacyPRStack = false,
      cleanupOldPRStacks = false,
      olderThanDays = 7,
      testPattern,
      capacityProviderOnly = false,
    } = options;

    log.info("Starting integration test...");
    log.info(`AWS Region: ${CONFIG.AWS_REGION}`);
    if (CONFIG.LAMBDA_ENDPOINT) {
      log.info(`Lambda Endpoint: ${CONFIG.LAMBDA_ENDPOINT}`);
    }

    if (cleanupOnly) {
      await this.cleanup(capacityProviderOnly);
      return;
    }

    if (cleanupLegacyPRStack) {
      await this.cleanupLegacyPRTestResources();
      return;
    }

    if (cleanupOldPRStacks) {
      await this.cleanupOldPRTestingStacks(olderThanDays);
      return;
    }

    if (!testOnly) {
      await this.deployFunctions(testPattern, {
        capacityProviderOnly,
      });
    }

    if (!deployOnly) {
      await this.runJestTests(testPattern, { capacityProviderOnly });
    }

    log.success("Integration test completed successfully!");

    if (!this.cleanupOnExit && !capacityProviderOnly) {
      log.warning(
        "Functions were not cleaned up. Use --cleanup-only to clean them up later.",
      );
    }
  }
}

async function main() {
  // Set up argument parser
  const parser = new ArgumentParser({
    description: "Integration test runner for Lambda Durable Functions SDK",
    epilog: `Environment Variables:
  AWS_REGION                     AWS region (default: us-east-1)
  LAMBDA_ENDPOINT                Custom Lambda endpoint URL
  TEST_ACCOUNT_ID                Test account ID for deployment
  TEST_LAMBDA_EXECUTION_ROLE_ARN Lambda execution role ARN for tests
  TEST_CAPACITY_PROVIDER_ARN     Capacity provider ARN for capacity-provider tests`,
  });

  // Add mutually exclusive group for operation modes
  const group = parser.add_mutually_exclusive_group();

  group.add_argument("--deploy-only", {
    action: "store_true",
    help: "Only deploy functions, don't run tests",
  });

  group.add_argument("--test-only", {
    action: "store_true",
    help: "Only run tests (assumes functions are already deployed)",
  });

  group.add_argument("--cleanup-only", {
    action: "store_true",
    help: "Only cleanup existing functions",
  });

  group.add_argument("--cleanup-legacy-pr-stack", {
    action: "store_true",
    help: "Only cleanup the legacy PR-scoped SAM stack for this runtime",
  });

  group.add_argument("--cleanup-old-pr-stacks", {
    action: "store_true",
    help: "Only cleanup PR testing stacks older than --older-than-days",
  });

  // Add test pattern argument
  parser.add_argument("--test-pattern", {
    help: "Optional test pattern to filter specific tests (used with --test-only)",
  });

  // Add deployment type arguments
  parser.add_argument("--capacity-provider-only", {
    action: "store_true",
    help: "Deploy only capacity provider functions",
  });

  // Add runtime argument
  parser.add_argument("--runtime", {
    help: "Node runtime version (e.g., 20.x, 22.x, 24.x)",
    default: "22.x",
    required: true,
  });

  parser.add_argument("--older-than-days", {
    help: "Age threshold in days for --cleanup-old-pr-stacks",
    default: 7,
  });

  // Parse command line arguments
  const args = parser.parse_args();

  // Configure options based on parsed arguments
  const options = {
    cleanupOnExit: true,
    deployOnly: args.deploy_only || false,
    testOnly: args.test_only || false,
    cleanupOnly: args.cleanup_only || false,
    cleanupLegacyPRStack: args.cleanup_legacy_pr_stack || false,
    cleanupOldPRStacks: args.cleanup_old_pr_stacks || false,
    olderThanDays: Number.parseInt(args.older_than_days, 10),
    testPattern: args.test_pattern,
    capacityProviderOnly: args.capacity_provider_only,
    runtime: args.runtime,
  };

  if (
    options.cleanupOldPRStacks &&
    (!Number.isFinite(options.olderThanDays) || options.olderThanDays < 1)
  ) {
    throw new Error("--older-than-days must be a positive integer");
  }

  // Disable cleanup on exit for deploy-only and test-only modes
  if (options.deployOnly || options.testOnly) {
    options.cleanupOnExit = false;
  }

  const runner = new IntegrationTestRunner(options);

  await runner.run(options);
}

// Run if this file is executed directly
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
