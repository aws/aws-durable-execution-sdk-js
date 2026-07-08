#!/usr/bin/env tsx

import { readFileSync, existsSync } from "fs";
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
  Architecture,
  PublishVersionCommand,
  FunctionVersionLatestPublished,
  LastUpdateStatus,
  State,
  LastUpdateStatusReasonCode,
  PutFunctionScalingConfigCommand,
  CreateFunctionCommandInput,
} from "@aws-sdk/client-lambda";
import { ExamplesWithConfig } from "../src/types";
import catalog from "@aws/durable-execution-sdk-js-examples/catalog";
import {
  CreateLogGroupCommand,
  CloudWatchLogsClient,
  PutRetentionPolicyCommand,
  ResourceAlreadyExistsException,
} from "@aws-sdk/client-cloudwatch-logs";

const DEBUG = false;

// ADOT Layer ARN mapping for X-Ray E2E test
// Format: arn:aws:lambda:${region}:615299751070:layer:AWSOpenTelemetryDistroJs:<version>
// ARNs sourced from: https://aws-otel.github.io/docs/getting-started/lambda#adot-lambda-layer-arns
const ADOT_LAYER_ARNS: Record<string, string> = {
  "us-east-1":
    "arn:aws:lambda:us-east-1:615299751070:layer:AWSOpenTelemetryDistroJs:7",
  "us-east-2":
    "arn:aws:lambda:us-east-2:615299751070:layer:AWSOpenTelemetryDistroJs:7",
  "us-west-1":
    "arn:aws:lambda:us-west-1:615299751070:layer:AWSOpenTelemetryDistroJs:7",
  "us-west-2":
    "arn:aws:lambda:us-west-2:615299751070:layer:AWSOpenTelemetryDistroJs:7",
  "eu-west-1":
    "arn:aws:lambda:eu-west-1:615299751070:layer:AWSOpenTelemetryDistroJs:7",
  "eu-west-2":
    "arn:aws:lambda:eu-west-2:615299751070:layer:AWSOpenTelemetryDistroJs:7",
  "eu-central-1":
    "arn:aws:lambda:eu-central-1:615299751070:layer:AWSOpenTelemetryDistroJs:7",
  "ap-northeast-1":
    "arn:aws:lambda:ap-northeast-1:615299751070:layer:AWSOpenTelemetryDistroJs:7",
  "ap-southeast-1":
    "arn:aws:lambda:ap-southeast-1:615299751070:layer:AWSOpenTelemetryDistroJs:7",
  "ap-southeast-2":
    "arn:aws:lambda:ap-southeast-2:615299751070:layer:AWSOpenTelemetryDistroJs:7",
};

/**
 * Checks if the handler corresponds to an otel function that needs ADOT.
 */
function isOtelFunction(handler: string): boolean {
  return handler.includes("otel-");
}

// Types
interface EnvironmentVariables {
  AWS_ACCOUNT_ID: string;
  AWS_REGION: string;
  CAPACITY_PROVIDER_ARN: string;
  LAMBDA_EXECUTION_ROLE_ARN?: string;
  GITHUB_ACTIONS?: string;
  GITHUB_ENV?: string;
  LAMBDA_ENDPOINT?: string;
}

// Configuration and validation
function parseArgs(): {
  example: string;
  functionName: string;
  runtime?: string;
  useCapacityProvider: boolean;
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

  parser.add_argument("--use-capacity-provider", {
    action: "store_true",
    help: "Deploy function with capacity provider configuration",
  });

  const args = parser.parse_args();

  return {
    example: args.example,
    functionName: args.function_name || args.example,
    runtime: args.runtime,
    useCapacityProvider: args.use_capacity_provider,
  };
}

function loadEnvironmentVariables(): EnvironmentVariables {
  // Validate required environment variables
  const requiredVars = ["AWS_ACCOUNT_ID", "AWS_REGION"];
  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error(
      `Missing required environment variables: ${missingVars.join(", ")}`,
    );
    process.exit(1);
  }

  return {
    AWS_ACCOUNT_ID: process.env.AWS_ACCOUNT_ID!,
    AWS_REGION: process.env.AWS_REGION!,
    CAPACITY_PROVIDER_ARN: process.env.CAPACITY_PROVIDER_ARN!,
    LAMBDA_EXECUTION_ROLE_ARN: process.env.LAMBDA_EXECUTION_ROLE_ARN,
    LAMBDA_ENDPOINT: process.env.LAMBDA_ENDPOINT,
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

function getLambdaExecutionRoleArn(env: EnvironmentVariables): string {
  return (
    env.LAMBDA_EXECUTION_ROLE_ARN ||
    `arn:aws:iam::${env.AWS_ACCOUNT_ID}:role/DurableFunctionsIntegrationTestRole`
  );
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

/**
 * Detects Lambda control-plane throttling (TooManyRequestsException / HTTP 429,
 * e.g. CallerRateLimitExceeded). The exception is not exported as a class by
 * @aws-sdk/client-lambda, so match on the error name / status code instead.
 */
function isThrottlingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const e = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    e.name === "TooManyRequestsException" || e.$metadata?.httpStatusCode === 429
  );
}

/**
 * Retries an operation on transient Lambda control-plane errors:
 * - ResourceConflictException: another update is in progress; clears quickly,
 *   so retry with a short fixed delay.
 * - TooManyRequestsException (429): the account exceeded its control-plane API
 *   rate. Bulk-deploying ~100+ functions across parallel runtime jobs can trip
 *   this, so back off exponentially (with jitter) to let the limit recover.
 */
async function retryOnConflict<T>(
  operation: () => Promise<T>,
  maxRetries: number = 10,
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      const isConflict = error instanceof ResourceConflictException;
      const isThrottle = isThrottlingError(error);
      if ((isConflict || isThrottle) && attempt < maxRetries - 1) {
        // Conflicts clear quickly; throttles need exponential backoff so the
        // per-account control-plane rate limit has time to recover.
        const baseDelayMs = isThrottle
          ? Math.min(1000 * 2 ** attempt, 20000)
          : 1000;
        const delayMs = baseDelayMs + Math.floor(Math.random() * 250);
        const label = isThrottle
          ? "TooManyRequestsException (throttled)"
          : "ResourceConflictException";
        console.warn(
          `${label} encountered: ${(error as Error).message}. ` +
            `Retrying ${attempt + 1}/${maxRetries} attempts in ${delayMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

async function runWithRetry<T, P>(
  operation: () => Promise<T>,
  checkOperationResult: (result: T) => {
    shouldRetry?: boolean;
    reason: string;
  },
  maxRetries: number,
) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await operation();
    const operationResult = checkOperationResult(result);
    if (!operationResult.shouldRetry) {
      console.log(`Stopped retrying. Reason: ${operationResult.reason}`);
      return result;
    }
    console.log(
      `Retrying: ${operationResult.reason}. ${attempt + 1}/${maxRetries} attempts`,
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
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
  useCapacityProvider: boolean,
  runtime?: Runtime,
): Promise<void> {
  console.log(
    `Deploying function: ${functionName} (creating new) with runtime: ${runtime}`,
  );

  const zipBuffer = readFileSync(zipFile);

  // IAM Role Requirements:
  // - The Lambda execution role must have `CloudWatchLambdaApplicationSignalsExecutionRolePolicy`
  //   attached for the otel-xray-e2e function (grants xray:PutTraceSegments, xray:PutTelemetryRecords,
  //   and related CloudWatch permissions needed by the ADOT layer to export spans to X-Ray).
  // - The test runner role must have `xray:GetTraceSummaries` and `xray:BatchGetTraces`
  //   permissions to query X-Ray traces in the e2e assertion tests.
  const roleArn = getLambdaExecutionRoleArn(env);

  const logGroupName = `/aws/lambda/${functionName}`;
  const cwlClient = new CloudWatchLogsClient();
  try {
    console.log(`Creating log group ${logGroupName}`);
    await cwlClient.send(
      new CreateLogGroupCommand({
        logGroupName,
      }),
    );
  } catch (err) {
    if (!(err instanceof ResourceAlreadyExistsException)) {
      throw err;
    }
  }

  await cwlClient.send(
    new PutRetentionPolicyCommand({
      logGroupName,
      retentionInDays: exampleConfig.durableConfig?.RetentionPeriodInDays ?? 7,
    }),
  );

  // Determine environment variables
  let envVars: Record<string, string> | undefined = env.LAMBDA_ENDPOINT
    ? { AWS_ENDPOINT_URL_LAMBDA: env.LAMBDA_ENDPOINT }
    : undefined;

  // Apply ADOT layer + Active Tracing for otel-xray-e2e
  let tracingConfig: { Mode: "Active" | "PassThrough" } | undefined;
  let layers: string[] | undefined;

  if (isOtelFunction(exampleConfig.handler)) {
    const adotArn = ADOT_LAYER_ARNS[env.AWS_REGION];
    if (!adotArn) {
      console.error(
        `Error: Unsupported region "${env.AWS_REGION}" for ADOT Lambda layer. ` +
          `Supported regions: ${Object.keys(ADOT_LAYER_ARNS).join(", ")}`,
      );
      process.exit(1);
    }
    tracingConfig = { Mode: "Active" };
    layers = [adotArn];
    envVars = {
      ...envVars,
      AWS_LAMBDA_EXEC_WRAPPER: "/opt/otel-instrument",
    };
  }

  const createParams: CreateFunctionCommandInput = {
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
    Timeout: exampleConfig.lambdaTimeoutSeconds ?? 60,
    MemorySize: useCapacityProvider ? 2048 : 128,
    Environment: {
      Variables: envVars,
    },
    Architectures: useCapacityProvider ? [Architecture.arm64] : undefined,
    CapacityProviderConfig:
      useCapacityProvider && exampleConfig.capacityProviderConfig
        ? {
            LambdaManagedInstancesCapacityProviderConfig: {
              CapacityProviderArn: env.CAPACITY_PROVIDER_ARN,
              ...exampleConfig.capacityProviderConfig,
            },
          }
        : undefined,
    LoggingConfig: {
      LogGroup: logGroupName,
    },
    TenancyConfig: exampleConfig.handler.includes("tenant-target")
      ? { TenantIsolationMode: "PER_TENANT" }
      : undefined,
    TracingConfig: tracingConfig,
    Layers: layers,
  };

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
  useCapacityProvider: boolean,
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
    Role: getLambdaExecutionRoleArn(env),
    Timeout: exampleConfig.lambdaTimeoutSeconds ?? 60,
    Environment: {
      Variables: (() => {
        let vars: Record<string, string> | undefined = env.LAMBDA_ENDPOINT
          ? { AWS_ENDPOINT_URL_LAMBDA: env.LAMBDA_ENDPOINT }
          : undefined;

        if (isOtelFunction(exampleConfig.handler)) {
          vars = {
            ...vars,
            AWS_LAMBDA_EXEC_WRAPPER: "/opt/otel-instrument",
          };
        }

        return vars;
      })(),
    },
    CapacityProviderConfig:
      useCapacityProvider && exampleConfig.capacityProviderConfig
        ? {
            LambdaManagedInstancesCapacityProviderConfig: {
              CapacityProviderArn: env.CAPACITY_PROVIDER_ARN,
              ...exampleConfig.capacityProviderConfig,
            },
          }
        : undefined,
    TenancyConfig: exampleConfig.handler.includes("tenant-target")
      ? { TenantIsolationMode: "PER_TENANT" }
      : undefined,
    ...(isOtelFunction(exampleConfig.handler)
      ? {
          TracingConfig: { Mode: "Active" as const },
          Layers: (() => {
            const adotArn = ADOT_LAYER_ARNS[env.AWS_REGION];
            if (!adotArn) {
              console.error(
                `Error: Unsupported region "${env.AWS_REGION}" for ADOT Lambda layer. ` +
                  `Supported regions: ${Object.keys(ADOT_LAYER_ARNS).join(", ")}`,
              );
              process.exit(1);
            }
            return [adotArn];
          })(),
        }
      : {}),
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
    const { example, functionName, runtime, useCapacityProvider } = parseArgs();
    const env = loadEnvironmentVariables();
    const exampleConfig = loadExampleConfiguration(example);

    // Validate capacity provider flag against example configuration
    if (useCapacityProvider) {
      if (!exampleConfig.capacityProviderConfig) {
        console.error(
          `Error: --use-capacity-provider flag specified but example '${example}' has no capacityProviderConfig defined`,
        );
        process.exit(1);
      }

      if (!process.env.CAPACITY_PROVIDER_ARN) {
        console.error(
          `Error: --use-capacity-provider flag specified but no CAPACITY_PROVIDER_ARN env variable is set`,
        );
        process.exit(1);
      }
    }

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
    console.log(
      `  Capacity Provider Enabled: ${!!exampleConfig.capacityProviderConfig}`,
    );
    console.log(`  Durability Enabled: ${!!exampleConfig.durableConfig}`);

    // Validate zip file exists
    validateZipFile(example);

    // Initialize Lambda client
    const lambdaClient = new LambdaClient({
      region: env.AWS_REGION,
      endpoint: env.LAMBDA_ENDPOINT,
    });

    console.log("Checking if function exists...");
    let functionExists = await checkFunctionExists(lambdaClient, functionName);
    let currentConfig: GetFunctionConfigurationCommandOutput;

    const zipFile = `${example}.zip`;
    const selectedRuntime = mapRuntimeToEnum(runtime);

    // Handle function deletion if configuration changes require it (outside retry logic)
    if (functionExists) {
      currentConfig = await getCurrentConfiguration(lambdaClient, functionName);
      if (!!currentConfig.DurableConfig !== !!exampleConfig.durableConfig) {
        console.log("Deleting function since durability changed");
        functionExists = false;
      }
      if (!!currentConfig.CapacityProviderConfig !== useCapacityProvider) {
        console.log("Deleting function since capacity provider changed");
        functionExists = false;
      }

      // Check if tenancy configuration needs to change
      const needsTenancy = exampleConfig.handler.includes("tenant-target");
      const hasTenancy = !!currentConfig.TenancyConfig;
      if (needsTenancy !== hasTenancy) {
        console.log("Deleting function since tenancy configuration changed");
        functionExists = false;
      }

      if (!functionExists) {
        await lambdaClient.send(
          new DeleteFunctionCommand({
            FunctionName: functionName,
          }),
        );
        // Wait for function to be fully deleted
        console.log("Waiting for function deletion to complete...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    // Handle function update or creation with retry logic
    await retryOnConflict(
      async () => {
        if (functionExists) {
          await updateFunction(
            lambdaClient,
            functionName,
            exampleConfig,
            zipFile,
            env,
            currentConfig!,
            useCapacityProvider,
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
            useCapacityProvider,
            selectedRuntime,
          );
        }

        if (useCapacityProvider) {
          for (let attempts = 1; attempts <= 2; attempts++) {
            console.log(
              "Publishing LATEST_PUBLISHED for function with capacity provider",
            );
            try {
              await retryOnConflict(
                () =>
                  lambdaClient.send(
                    new PublishVersionCommand({
                      FunctionName: functionName,
                      PublishTo:
                        FunctionVersionLatestPublished.LATEST_PUBLISHED,
                    }),
                  ),
                180,
              );
            } catch (err) {
              throw new Error("Timed out publishing LATEST_PUBLISHED version", {
                cause: err,
              });
            }

            try {
              console.log("Waiting for function to enter active state");
              const qualifier = "$LATEST.PUBLISHED";
              const functionWithQualifier = `${functionName}:${qualifier}`;

              const result = await runWithRetry(
                async () => {
                  return getCurrentConfiguration(
                    lambdaClient,
                    functionWithQualifier,
                  );
                },
                (currentConfiguration) => {
                  if (
                    currentConfiguration.LastUpdateStatus ===
                      LastUpdateStatus.Failed ||
                    currentConfiguration.State === State.Failed
                  ) {
                    if (
                      currentConfiguration.LastUpdateStatusReasonCode ===
                      LastUpdateStatusReasonCode.CapacityProviderScalingLimitExceeded
                    ) {
                      return {
                        shouldRetry: false,
                        reason: `Capacity provider limit exceeded.`,
                      };
                    }

                    throw new Error(
                      `Function ${functionWithQualifier} failed to enter successful state. ${currentConfiguration.LastUpdateStatusReason ?? currentConfiguration.StateReason}`,
                    );
                  }

                  if (
                    currentConfiguration.State !== State.Active ||
                    currentConfiguration.LastUpdateStatus ===
                      LastUpdateStatus.InProgress
                  ) {
                    return {
                      shouldRetry: true,
                      reason: `Function update status is currently ${currentConfiguration.LastUpdateStatus ?? currentConfiguration.State}`,
                    };
                  }

                  return {
                    shouldRetry: false,
                    reason: "Function is now active",
                  };
                },
                900,
              );

              if (
                result.LastUpdateStatusReasonCode !==
                LastUpdateStatusReasonCode.CapacityProviderScalingLimitExceeded
              ) {
                console.log("Setting function scaling config");
                await lambdaClient.send(
                  new PutFunctionScalingConfigCommand({
                    FunctionName: functionName,
                    Qualifier: qualifier,
                    FunctionScalingConfig: {
                      MinExecutionEnvironments: 1,
                      MaxExecutionEnvironments: 1,
                    },
                  }),
                );
                break;
              }

              console.log(
                "Deleting function version and retrying since capacity limit exceeded",
              );
              // If the capacity provider limit exceeded, we should delete the version and retry once.
              // It's possible for a failed version to take up capacity.
              await lambdaClient.send(
                new DeleteFunctionCommand({
                  FunctionName: functionWithQualifier,
                }),
              );

              console.log("Waiting for function to be deleted");
              await runWithRetry(
                async () => {
                  try {
                    await getCurrentConfiguration(
                      lambdaClient,
                      functionWithQualifier,
                    );
                    return true;
                  } catch (err) {
                    if (err instanceof ResourceNotFoundException) {
                      return false;
                    }
                    throw err;
                  }
                },
                (exists) => {
                  if (exists) {
                    return {
                      shouldRetry: true,
                      reason: "Function still exists",
                    };
                  }

                  return {
                    shouldRetry: false,
                    reason: "Function deleted successfully",
                  };
                },
                120,
              );
            } catch (err) {
              if (err instanceof ResourceConflictException) {
                throw new Error(
                  "Timed out waiting for function to enter active state",
                  {
                    cause: err,
                  },
                );
              }
              throw err;
            }
          }
        }
      },
      useCapacityProvider ? 120 : undefined,
    );

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
