// @ts-check

import { execSync } from "child_process";
import { appendFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ArgumentParser } from "argparse";

import examplesCatalog from "@aws/durable-execution-sdk-js-examples/catalog";
import {
  LambdaClient,
  DeleteFunctionCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-lambda";

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

  // Get integration examples from catalog
  getIntegrationExamples() {
    log.info("Getting integration examples...");
    return examplesCatalog;
  }

  /**
   *
   * @param {{ capacityProviderOnly: boolean }} options
   * @returns
   */
  getFunctionNameMap(options) {
    const examples = this.getIntegrationExamples();
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
        if (process.env.GITHUB_EVENT_NAME === "pull_request") {
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

    if (!process.env.AWS_ACCOUNT_ID) {
      throw new Error("Missing required AWS_ACCOUNT_ID for deployment");
    }

    const examples = this.getIntegrationExamples();
    const examplesDir = CONFIG.EXAMPLES_PACKAGE_PATH;

    const functionNameMap = this.getFunctionNameMap({
      capacityProviderOnly: capacityProviderOnly,
    });

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

      // Deploy regular function (unless capacityProviderOnly is true)
      if (!capacityProviderOnly) {
        const regularFunctionName = functionNameMap[handlerFile].functionName;
        log.info(
          `Deploying regular function: ${regularFunctionName} (handler: ${handlerFile})`,
        );

        let regularDeployCommand = `npm run deploy -- "${handlerFile}" '${regularFunctionName}' --runtime ${this.runtime}`;
        this.execCommand(regularDeployCommand, {
          cwd: examplesDir,
        });
        log.success(`Deployed regular function: ${regularFunctionName}`);
      }

      // Deploy capacity provider function (only if capacityProviderOnly is true)
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

  // Run Jest integration tests
  async runJestTests(/** @type {string | undefined} */ testPattern) {
    log.info("Running Jest integration tests...");

    const examplesDir = CONFIG.EXAMPLES_PACKAGE_PATH;

    // For Jest integration tests, exclude capacity provider functions since they weren't deployed
    const functionsWithQualifier = Object.fromEntries(
      Object.entries(
        this.getFunctionNameMap({ capacityProviderOnly: false }),
      ).map(([key, { functionName, qualifier }]) => {
        return [key, `${functionName}:${qualifier}`];
      }),
    );

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
    const functionNameMap = this.getFunctionNameMap({
      capacityProviderOnly: capacityProviderOnly,
    });

    if (Object.keys(functionNameMap).length === 0) {
      log.warning("No functions to clean up");
      return;
    }

    log.info("Cleaning up deployed functions...");

    // Initialize Lambda client for cleanup
    const lambdaClient = this.initializeLambdaClient();

    for (const { functionName } of Object.values(functionNameMap)) {
      log.info(`Deleting function: ${functionName}`);

      const deleteCommand = new DeleteFunctionCommand({
        FunctionName: functionName,
      });

      try {
        await lambdaClient.send(deleteCommand);
      } catch (error) {
        if (error instanceof ResourceNotFoundException) {
          log.warning(`Function not found: ${functionName}`);
          continue;
        }
        throw error;
      }
      log.success(`Deleted function: ${functionName}`);
    }
  }

  /**
   * @param {Object} options
   * @param {boolean} [options.deployOnly]
   * @param {boolean} [options.testOnly]
   * @param {boolean} [options.cleanupOnly]
   * @param {string} [options.testPattern]
   * @param {boolean} [options.capacityProviderOnly]
   */
  async run(options = {}) {
    const {
      deployOnly = false,
      testOnly = false,
      cleanupOnly = false,
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

    if (!testOnly) {
      await this.deployFunctions(testPattern, {
        capacityProviderOnly,
      });
    }

    if (!deployOnly) {
      await this.runJestTests(testPattern);
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
  AWS_REGION      AWS region (default: us-east-1)
  LAMBDA_ENDPOINT Custom Lambda endpoint URL`,
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

  // Parse command line arguments
  const args = parser.parse_args();

  // Configure options based on parsed arguments
  const options = {
    cleanupOnExit: true,
    deployOnly: args.deploy_only || false,
    testOnly: args.test_only || false,
    cleanupOnly: args.cleanup_only || false,
    testPattern: args.test_pattern,
    capacityProviderOnly: args.capacity_provider_only,
    runtime: args.runtime,
  };

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
