#!/usr/bin/env tsx

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { config as dotenvConfig } from "dotenv";
import { ArgumentParser } from "argparse";
import {
  LambdaClient,
  GetFunctionCommand,
  GetFunctionConfigurationCommand,
  CreateFunctionCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  Runtime,
  GetFunctionConfigurationCommandOutput,
  ResourceNotFoundException,
  ResourceConflictException,
  UpdateFunctionConfigurationCommandInput,
  DeleteFunctionCommand,
} from "@aws-sdk/client-lambda";
import { ExamplesWithConfig } from "../src/types";
import catalog from "@aws/durable-execution-sdk-js-examples/catalog";

const DEBUG = false;

// Types
interface EnvironmentVariables {
  AWS_ACCOUNT_ID: string;
  LAMBDA_ENDPOINT: string;
  AWS_REGION: string;
  GITHUB_ACTIONS?: string;
  GITHUB_ENV?: string;
}

// Configuration and validation
function parseArgs(): {
  example: string;
  functionName: string;
  runtime?: string;
} {
  const parser = new ArgumentParser({
    description: "Deploy Lambda function with AWS Durable Execution SDK",
    add_help: true,
  });

  parser.add_argument("example", {
    help: "Example name to deploy (e.g., hello-world)",
  });

  parser.add_argument("function_name", {
    nargs: "?",
    help: "Custom function name (defaults to example name)",
  });

  parser.add_argument("--runtime", {
    choices: ["20.x", "22.x", "24.x"],
    help: "Lambda nodejs runtime version (default: 24.x)",
  });

  const args = parser.parse_args();

  return {
    example: args.example,
    functionName: args.function_name || args.example,
    runtime: args.runtime,
  };
}

function loadEnvironmentVariables(): EnvironmentVariables {
  // Load environment variables
  if (!process.env.GITHUB_ACTIONS) {
    // Not in GitHub Actions - try to load .secrets file
    const secretsPath = resolve("../../.secrets");
    if (existsSync(secretsPath)) {
      dotenvConfig({ path: secretsPath, override: true, quiet: true });
    } else {
      console.warn("Warning: .secrets file not found");
    }
  }

  // Validate required environment variables
  const requiredVars = ["AWS_ACCOUNT_ID", "LAMBDA_ENDPOINT"];
  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error(
      `Missing required environment variables: ${missingVars.join(", ")}`,
    );
    process.exit(1);
  }

  return {
    AWS_ACCOUNT_ID: process.env.AWS_ACCOUNT_ID!,
    LAMBDA_ENDPOINT: process.env.LAMBDA_ENDPOINT!,
    AWS_REGION: process.env.AWS_REGION!,
    GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
    GITHUB_ENV: process.env.GITHUB_ENV,
  };
}

function loadExampleConfiguration(exampleName: string): ExamplesWithConfig {
  const targetHandler = `${exampleName}.handler`;
  const exampleConfig = catalog.find(
    (example) => example.handler === targetHandler,
  );

  if (!exampleConfig) {
    console.error(
      `Error: Example with handler '${targetHandler}' not found in catalog`,
    );
    console.error("Available handlers:");
    catalog.forEach((example) => console.error(`  ${example.handler}`));
    process.exit(1);
  }

  return exampleConfig;
}

function validateZipFile(exampleName: string): void {
  const zipFile = `${exampleName}.zip`;
  if (!existsSync(zipFile)) {
    console.error(
      `Error: ${zipFile} not found. Please build and package first.`,
    );
    console.error(`Run: npm run build && npm run package -- ${exampleName}`);
    process.exit(1);
  }
}

function mapRuntimeToEnum(runtimeString?: string): Runtime {
  if (!runtimeString) {
    return Runtime.nodejs22x; // Default runtime
  }

  switch (runtimeString) {
    case "20.x":
      return Runtime.nodejs20x;
    case "22.x":
      return Runtime.nodejs22x;
    case "24.x":
      return "nodejs24.x" as Runtime;
    default:
      console.error(`Invalid runtime: ${runtimeString}`);
      console.error("Available runtimes: 20x, 22x, 24x");
      process.exit(1);
  }
}

// Lambda operations
async function checkFunctionExists(
  lambdaClient: LambdaClient,
  functionName: string,
): Promise<boolean> {
  try {
    await lambdaClient.send(
      new GetFunctionCommand({ FunctionName: functionName }),
    );
    return true;
  } catch (error: unknown) {
    if (error instanceof ResourceNotFoundException) {
      return false;
    }
    throw error;
  }
}

async function retryOnConflict<T>(
  operation: () => Promise<T>,
  maxRetries: number = 10,
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      if (
        error instanceof ResourceConflictException &&
        attempt < maxRetries - 1
      ) {
        console.warn(
          `ResourceConflictException encountered: ${error.message}. Retrying ${attempt + 1}/${maxRetries} attempts`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

async function getCurrentConfiguration(
  lambdaClient: LambdaClient,
  functionName: string,
): Promise<GetFunctionConfigurationCommandOutput> {
  const command = new GetFunctionConfigurationCommand({
    FunctionName: functionName,
  });
  return await lambdaClient.send(command);
}

async function createFunction(
  lambdaClient: LambdaClient,
  functionName: string,
  exampleConfig: ExamplesWithConfig,
  zipFile: string,
  env: EnvironmentVariables,
  runtime?: Runtime,
): Promise<void> {
  console.log(
    `Deploying function: ${functionName} (creating new) with runtime: ${runtime}`,
  );

  const zipBuffer = readFileSync(zipFile);
  const roleArn = `arn:aws:iam::${env.AWS_ACCOUNT_ID}:role/DurableFunctionsIntegrationTestRole`;

  const createParams = {
    FunctionName: functionName,
    Runtime: runtime,
    Role: roleArn,
    Handler: exampleConfig.handler,
    Description: exampleConfig.description,
    Code: { ZipFile: zipBuffer },
    DurableConfig: exampleConfig.durableConfig
      ? {
          RetentionPeriodInDays:
            exampleConfig.durableConfig.RetentionPeriodInDays,
          ExecutionTimeout: exampleConfig.durableConfig.ExecutionTimeout,
        }
      : undefined,
    Timeout: 60,
    MemorySize: 128,
    Environment: {
      Variables: {
        AWS_ENDPOINT_URL_LAMBDA: env.LAMBDA_ENDPOINT,
      },
    },
  } as const;

  const command = new CreateFunctionCommand(createParams);
  await lambdaClient.send(command);
  console.log("Function created successfully");
}

async function updateFunction(
  lambdaClient: LambdaClient,
  functionName: string,
  exampleConfig: ExamplesWithConfig,
  zipFile: string,
  env: EnvironmentVariables,
  currentConfig: GetFunctionConfigurationCommandOutput,
  runtime?: Runtime,
): Promise<void> {
  console.log(`Deploying function: ${functionName} (updating existing)`);

  const currentRetention = currentConfig.DurableConfig?.RetentionPeriodInDays;
  const currentTimeout = currentConfig.DurableConfig?.ExecutionTimeout;
  const targetRetention = exampleConfig.durableConfig?.RetentionPeriodInDays;
  const targetTimeout = exampleConfig.durableConfig?.ExecutionTimeout;

  console.log("Function exists with current DurableConfig:");
  console.log(`  Current Retention: ${currentRetention} days`);
  console.log(`  Current Timeout: ${currentTimeout} seconds`);
  console.log(`  Target Retention: ${targetRetention} days`);
  console.log(`  Target Timeout: ${targetTimeout} seconds`);

  // Update function code
  console.log("Updating function code...");
  const zipBuffer = readFileSync(zipFile);
  const updateCodeCommand = new UpdateFunctionCodeCommand({
    FunctionName: functionName,
    ZipFile: zipBuffer,
  });
  await lambdaClient.send(updateCodeCommand);

  // Update environment variables
  console.log("Updating environment variables...");
  const updateEnvParams: UpdateFunctionConfigurationCommandInput = {
    FunctionName: functionName,
    Runtime: runtime,
    Environment: {
      Variables: {
        AWS_ENDPOINT_URL_LAMBDA: env.LAMBDA_ENDPOINT,
      },
    },
  };

  // Check if DurableConfig needs updating
  if (
    currentRetention !== targetRetention ||
    currentTimeout !== targetTimeout
  ) {
    console.log("DurableConfig differs, updating configuration...");
    updateEnvParams.DurableConfig = {
      RetentionPeriodInDays: targetRetention,
      ExecutionTimeout: targetTimeout,
    };
  } else {
    console.log("DurableConfig is up to date");
  }

  const updateEnvCommand = new UpdateFunctionConfigurationCommand(
    updateEnvParams,
  );
  await retryOnConflict(() => lambdaClient.send(updateEnvCommand));
}

async function showFinalConfiguration(
  lambdaClient: LambdaClient,
  functionName: string,
): Promise<void> {
  console.log("Function configuration:");
  const command = new GetFunctionConfigurationCommand({
    FunctionName: functionName,
  });
  const result = await lambdaClient.send(command);
  console.log(JSON.stringify(result, null, 2));
}

// Main function
async function main(): Promise<void> {
  try {
    // Parse arguments and load configuration
    const { example, functionName, runtime } = parseArgs();
    const env = loadEnvironmentVariables();
    const exampleConfig = loadExampleConfiguration(example);

    console.log("Found example configuration:");
    console.log(`  Name: ${exampleConfig.name}`);
    console.log(`  Function Name: ${functionName}`);
    console.log(`  Handler: ${exampleConfig.handler}`);
    console.log(`  Description: ${exampleConfig.description}`);
    if (runtime) {
      console.log(`  Runtime: ${runtime}`);
    }
    console.log(
      `  Retention: ${exampleConfig.durableConfig?.RetentionPeriodInDays} days`,
    );
    console.log(
      `  Timeout: ${exampleConfig.durableConfig?.ExecutionTimeout} seconds`,
    );

    // Validate zip file exists
    validateZipFile(example);

    // Initialize Lambda client
    const lambdaClient = new LambdaClient({
      region: env.AWS_REGION,
      endpoint: env.LAMBDA_ENDPOINT,
    });

    await retryOnConflict(async () => {
      console.log("Checking if function exists...");
      let functionExists = await checkFunctionExists(
        lambdaClient,
        functionName,
      );
      let currentConfig: GetFunctionConfigurationCommandOutput;

      const zipFile = `${example}.zip`;

      const selectedRuntime = mapRuntimeToEnum(runtime);

      if (functionExists) {
        currentConfig = await getCurrentConfiguration(
          lambdaClient,
          functionName,
        );
        if (!!currentConfig.DurableConfig !== !!exampleConfig.durableConfig) {
          console.log("Deleting function since durable changed");
          await lambdaClient.send(
            new DeleteFunctionCommand({
              FunctionName: functionName,
            }),
          );
          functionExists = false;
        }
      }

      if (functionExists) {
        await updateFunction(
          lambdaClient,
          functionName,
          exampleConfig,
          zipFile,
          env,
          currentConfig!,
          selectedRuntime,
        );
      } else {
        console.log("Function does not exist");
        await createFunction(
          lambdaClient,
          functionName,
          exampleConfig,
          zipFile,
          env,
          selectedRuntime,
        );
      }
    });

    // Set GITHUB_ENV if running in GitHub Actions
    if (env.GITHUB_ENV) {
      const fs = await import("fs");
      fs.appendFileSync(env.GITHUB_ENV, `FUNCTION_NAME=${functionName}\n`);
    }

    console.log(`Successfully deployed function: ${functionName}`);

    if (DEBUG) {
      // Show final configuration
      await showFinalConfiguration(lambdaClient, functionName);
    }

    console.log("Deployment completed successfully!");
  } catch (error) {
    console.error("Deployment failed:", error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}
