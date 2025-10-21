#!/usr/bin/env tsx

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { config as dotenvConfig } from "dotenv";
import {
  LambdaClient,
  GetFunctionCommand,
  GetFunctionConfigurationCommand,
  CreateFunctionCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  GetPolicyCommand,
  AddPermissionCommand,
  Runtime,
  GetFunctionConfigurationCommandOutput,
} from "@aws-sdk/client-lambda";
import { ExamplesWithConfig } from "../src/types";
import catalog from "../src/utils/examples-catalog";

// Types
interface EnvironmentVariables {
  AWS_ACCOUNT_ID: string;
  LAMBDA_ENDPOINT: string;
  INVOKE_ACCOUNT_ID: string;
  AWS_REGION: string;
  KMS_KEY_ARN?: string;
  GITHUB_ACTIONS?: string;
  GITHUB_ENV?: string;
}

// Configuration and validation
function validateArgs(): { example: string; functionName: string } {
  const args = process.argv.slice(2);

  if (args.length < 1 || args.length > 2) {
    console.error("Usage: deploy-lambda.ts <example-name> [function-name]");
    console.error("Example: deploy-lambda.ts hello-world");
    console.error("Example: deploy-lambda.ts hello-world custom-function-name");
    process.exit(1);
  }

  const example = args[0];
  const functionName = args[1] || example;

  return { example, functionName };
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
  const requiredVars = [
    "AWS_ACCOUNT_ID",
    "LAMBDA_ENDPOINT",
    "INVOKE_ACCOUNT_ID",
  ];
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
    INVOKE_ACCOUNT_ID: process.env.INVOKE_ACCOUNT_ID!,
    AWS_REGION: process.env.AWS_REGION || "us-west-2",
    KMS_KEY_ARN: process.env.KMS_KEY_ARN,
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
  } catch (error: any) {
    if (error.name === "ResourceNotFoundException") {
      return false;
    }
    throw error;
  }
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
): Promise<void> {
  console.log(`Deploying function: ${functionName} (creating new)`);

  const zipBuffer = readFileSync(zipFile);
  const roleArn = `arn:aws:iam::${env.AWS_ACCOUNT_ID}:role/DurableFunctionsIntegrationTestRole`;

  const createParams: any = {
    FunctionName: functionName,
    Runtime: Runtime.nodejs22x,
    Role: roleArn,
    Handler: exampleConfig.handler,
    Description: exampleConfig.description,
    Code: { ZipFile: zipBuffer },
    DurableConfig: {
      RetentionPeriodInDays: exampleConfig.durableConfig.RetentionPeriodInDays,
      ExecutionTimeout: exampleConfig.durableConfig.ExecutionTimeout,
    },
    Timeout: 60,
    MemorySize: 128,
    Environment: {
      Variables: {
        AWS_ENDPOINT_URL_LAMBDA: env.LAMBDA_ENDPOINT,
      },
    },
  };

  if (env.KMS_KEY_ARN) {
    createParams.KMSKeyArn = env.KMS_KEY_ARN;
  }

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
  currentConfig: any,
): Promise<void> {
  console.log(`Deploying function: ${functionName} (updating existing)`);

  const currentRetention =
    currentConfig.DurableConfig?.RetentionPeriodInDays || "none";
  const currentTimeout =
    currentConfig.DurableConfig?.ExecutionTimeout || "none";
  const targetRetention = exampleConfig.durableConfig.RetentionPeriodInDays;
  const targetTimeout = exampleConfig.durableConfig.ExecutionTimeout;

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
  const updateEnvParams: any = {
    FunctionName: functionName,
    Environment: {
      Variables: {
        AWS_ENDPOINT_URL_LAMBDA: env.LAMBDA_ENDPOINT,
      },
    },
  };

  if (env.KMS_KEY_ARN) {
    updateEnvParams.KMSKeyArn = env.KMS_KEY_ARN;
  }

  const updateEnvCommand = new UpdateFunctionConfigurationCommand(
    updateEnvParams,
  );
  await lambdaClient.send(updateEnvCommand);

  // Check if DurableConfig needs updating
  if (
    currentRetention !== targetRetention ||
    currentTimeout !== targetTimeout
  ) {
    console.log("DurableConfig differs, updating configuration...");
    const updateConfigCommand = new UpdateFunctionConfigurationCommand({
      FunctionName: functionName,
      DurableConfig: {
        RetentionPeriodInDays: targetRetention,
        ExecutionTimeout: targetTimeout,
      },
    });
    await lambdaClient.send(updateConfigCommand);
  } else {
    console.log("DurableConfig is up to date");
  }
}

async function checkAndAddResourcePolicy(
  lambdaClient: LambdaClient,
  functionName: string,
  invokeAccountId: string,
): Promise<void> {
  console.log("Checking resource policy...");

  try {
    const getPolicyCommand = new GetPolicyCommand({
      FunctionName: functionName,
    });
    const policyResult = await lambdaClient.send(getPolicyCommand);

    if (
      policyResult.Policy &&
      policyResult.Policy.includes("dex-invoke-permission")
    ) {
      console.log("Resource policy already exists, skipping");
      return;
    }
  } catch (error: any) {
    if (error.name !== "ResourceNotFoundException") {
      throw error;
    }
    // Policy doesn't exist, we'll add it below
  }

  console.log("Adding resource policy to invoke function...");
  const addPermissionCommand = new AddPermissionCommand({
    FunctionName: functionName,
    StatementId: "dex-invoke-permission",
    Action: "lambda:InvokeFunction",
    Principal: invokeAccountId,
  });

  await lambdaClient.send(addPermissionCommand);
  console.log("Resource policy added successfully");
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
    const { example, functionName } = validateArgs();
    const env = loadEnvironmentVariables();
    const exampleConfig = loadExampleConfiguration(example);

    console.log("Found example configuration:");
    console.log(`  Name: ${exampleConfig.name}`);
    console.log(`  Function Name: ${functionName}`);
    console.log(`  Handler: ${exampleConfig.handler}`);
    console.log(`  Description: ${exampleConfig.description}`);
    console.log(
      `  Retention: ${exampleConfig.durableConfig.RetentionPeriodInDays} days`,
    );
    console.log(
      `  Timeout: ${exampleConfig.durableConfig.ExecutionTimeout} seconds`,
    );

    // Validate zip file exists
    validateZipFile(example);

    // Initialize Lambda client
    const lambdaClient = new LambdaClient({
      region: env.AWS_REGION,
      endpoint: env.LAMBDA_ENDPOINT,
    });

    console.log("Checking if function exists...");
    const functionExists = await checkFunctionExists(
      lambdaClient,
      functionName,
    );

    const zipFile = `${example}.zip`;

    if (functionExists) {
      const currentConfig = await getCurrentConfiguration(
        lambdaClient,
        functionName,
      );
      await updateFunction(
        lambdaClient,
        functionName,
        exampleConfig,
        zipFile,
        env,
        currentConfig,
      );
    } else {
      console.log("Function does not exist");
      await createFunction(
        lambdaClient,
        functionName,
        exampleConfig,
        zipFile,
        env,
      );
    }

    // Add resource policy
    await checkAndAddResourcePolicy(
      lambdaClient,
      functionName,
      env.INVOKE_ACCOUNT_ID,
    );

    // Set GITHUB_ENV if running in GitHub Actions
    if (env.GITHUB_ENV) {
      const fs = await import("fs");
      fs.appendFileSync(env.GITHUB_ENV, `FUNCTION_NAME=${functionName}\n`);
    }

    console.log(`Successfully deployed function: ${functionName}`);

    // Show final configuration
    await showFinalConfiguration(lambdaClient, functionName);

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
