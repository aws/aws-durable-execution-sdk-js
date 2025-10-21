// @ts-check

import { execSync } from "child_process";
import { appendFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import examplesCatalog from "@aws/durable-execution-sdk-js-examples/catalog";
import {
  LambdaClient,
  DeleteFunctionCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-lambda";

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const CONFIG = {
  AWS_REGION: process.env.AWS_REGION || "us-west-2",
  LAMBDA_ENDPOINT:
    process.env.LAMBDA_ENDPOINT ||
    "https://durable.durable-functions.devo.us-west-2.lambda.aws.a2z.com",
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
  AWS_ACCOUNT_ID: process.env.AWS_ACCOUNT_ID,
};

if (!CONFIG.AWS_ACCOUNT_ID) {
  throw new Error("AWS_ACCOUNT_ID environment variable must be set.");
}

class IntegrationTestRunner {
  /**
   * @param {Object} options
   * @param {boolean} [options.cleanupOnExit]
   */
  constructor(options = {}) {
    this.cleanupOnExit = options.cleanupOnExit !== false;
    this.isGitHubActions = !!process.env.GITHUB_ACTIONS;
    /** @type {Record<string, string> | undefined} */
    this.functionNameMap = undefined;
    /** @type {import('@aws-sdk/client-lambda').LambdaClient | null} */
    this.lambdaClient = null;

    // Set up cleanup handler
    if (this.cleanupOnExit) {
      process.on("exit", () => this.cleanup());
      process.on("SIGINT", () => {
        this.cleanup();
        process.exit(130);
      });
      process.on("SIGTERM", () => {
        this.cleanup();
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

  getFunctionNameMap() {
    if (this.functionNameMap) {
      return this.functionNameMap;
    }

    const examples = this.getIntegrationExamples();
    /** @type {Record<string, string>} */
    const functionNameMap = {};

    for (const example of examples) {
      const exampleName = example.name;
      const exampleHandler = example.handler;

      // Build function name
      let functionName;
      if (this.isGitHubActions) {
        const baseName = exampleName.replace(/\s/g, "") + "-TypeScript";
        if (process.env.GITHUB_EVENT_NAME === "pull_request") {
          if (!process.env.GITHUB_EVENT_NUMBER) {
            throw new Error(
              "Could not find GITHUB_EVENT_NUMBER environment variable",
            );
          }
          functionName = `arn:aws:lambda:${CONFIG.AWS_REGION}:${CONFIG.AWS_ACCOUNT_ID}:${baseName}-PR-${process.env.GITHUB_EVENT_NUMBER}`;
        } else {
          functionName = `arn:aws:lambda:${CONFIG.AWS_REGION}:${CONFIG.AWS_ACCOUNT_ID}:${baseName}`;
        }
      } else {
        const name = exampleName.replace(/\s/g, "") + "-TypeScript-Local";
        functionName = `arn:aws:lambda:${CONFIG.AWS_REGION}:${CONFIG.AWS_ACCOUNT_ID}:${name}`;
      }

      const handlerFile = exampleHandler.replace(/\.handler$/, "");
      functionNameMap[handlerFile] = functionName;
    }

    this.functionNameMap = functionNameMap;
    return functionNameMap;
  }

  // Deploy Lambda functions
  async deployFunctions() {
    log.info("Deploying Lambda functions...");

    const examples = this.getIntegrationExamples();
    const examplesDir = CONFIG.EXAMPLES_PACKAGE_PATH;

    const functionNameMap = this.getFunctionNameMap();

    for (const example of examples) {
      const exampleHandler = example.handler;

      // Extract handler file name from catalog
      const handlerFile = exampleHandler.replace(/\.handler$/, "");
      const functionName = functionNameMap[handlerFile];

      log.info(`Deploying function: ${functionName} (handler: ${handlerFile})`);

      // Package the function
      this.execCommand(`npm run package -- "${handlerFile}"`, {
        cwd: examplesDir,
      });

      // Deploy using npm script
      this.execCommand(`npm run deploy -- "${handlerFile}" '${functionName}'`, {
        cwd: examplesDir,
      });
      log.success(`Deployed function: ${functionName}`);
    }

    log.info("Function name map:");
    console.log(JSON.stringify(functionNameMap, null, 2));

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

    const functionsWithLatestArn = Object.fromEntries(
      Object.entries(this.getFunctionNameMap()).map(([key, value]) => {
        return [key, `${value}:$LATEST`];
      }),
    );

    // Set environment variables
    const env = {
      ...process.env,
      FUNCTION_NAME_MAP: JSON.stringify(functionsWithLatestArn),
      LAMBDA_ENDPOINT: CONFIG.LAMBDA_ENDPOINT,
    };

    log.info("Running Jest integration tests with function map:");
    console.log(JSON.stringify(functionsWithLatestArn, null, 2));
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

  // Cleanup deployed functions
  async cleanup() {
    const functionNameMap = this.getFunctionNameMap();

    if (Object.keys(functionNameMap).length === 0) {
      log.warning("No functions to clean up");
      return;
    }

    log.info("Cleaning up deployed functions...");

    // Initialize Lambda client for cleanup
    const lambdaClient = this.initializeLambdaClient();

    for (const functionName of Object.values(functionNameMap)) {
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
   */
  async run(options = {}) {
    const {
      deployOnly = false,
      testOnly = false,
      cleanupOnly = false,
      testPattern,
    } = options;

    log.info("Starting integration test...");
    log.info(`AWS Region: ${CONFIG.AWS_REGION}`);
    if (CONFIG.LAMBDA_ENDPOINT) {
      log.info(`Lambda Endpoint: ${CONFIG.LAMBDA_ENDPOINT}`);
    }

    if (cleanupOnly) {
      await this.cleanup();
      return;
    }

    if (!testOnly) {
      await this.deployFunctions();
    }

    if (!deployOnly) {
      await this.runJestTests(testPattern);
    }

    log.success("Integration test completed successfully!");

    if (!this.cleanupOnExit) {
      log.warning(
        "Functions were not cleaned up. Use --cleanup-only to clean them up later.",
      );
    }
  }
}

// CLI interface
function showUsage() {
  console.log("Usage: node integration-test.js [OPTIONS] [TEST_PATTERN]");
  console.log("");
  console.log("Options:");
  console.log("  --deploy-only   Only deploy functions, don't run tests");
  console.log(
    "  --test-only [pattern]  Only run tests (assumes functions are already deployed)",
  );
  console.log(
    "                         Optional test pattern to filter specific tests",
  );
  console.log("  --cleanup-only  Only cleanup existing functions");
  console.log("  --help          Show this help message");
  console.log("");
  console.log("Examples:");
  console.log("  node integration-test.js --test-only my-test-name");
  console.log("  node integration-test.js --test-only");
  console.log("");
  console.log("Environment Variables:");
  console.log("  AWS_REGION      AWS region (default: us-west-2)");
  console.log("  LAMBDA_ENDPOINT Custom Lambda endpoint URL");
  console.log("");
}

async function main() {
  const args = process.argv.slice(2);

  // Parse command line arguments
  /** @type {{ cleanupOnExit: boolean, deployOnly: boolean, testOnly: boolean, cleanupOnly: boolean, testPattern?: string }} */
  const options = {
    cleanupOnExit: true,
    deployOnly: false,
    testOnly: false,
    cleanupOnly: false,
    testPattern: undefined,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--deploy-only":
        options.deployOnly = true;
        options.cleanupOnExit = false;
        break;
      case "--test-only":
        options.testOnly = true;
        options.cleanupOnExit = false;
        // Check if the next argument is a test pattern (not another flag)
        if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
          options.testPattern = args[i + 1];
          i++; // Skip the next argument since we consumed it as test pattern
        }
        break;
      case "--cleanup-only":
        options.cleanupOnly = true;
        break;
      case "--help":
        showUsage();
        process.exit(0);
      default:
        log.error(`Unknown option: ${arg}`);
        showUsage();
        process.exit(1);
    }
  }

  const runner = new IntegrationTestRunner(options);

  await runner.run(options);
}

// Run if this file is executed directly
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
