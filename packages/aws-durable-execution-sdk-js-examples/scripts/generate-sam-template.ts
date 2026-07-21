#!/usr/bin/env node

import fs from "fs";
import path from "path";
import yaml from "js-yaml";

// ADOT Layer ARN mapping for X-Ray E2E test.
// Format: arn:aws:lambda:${region}:615299751070:layer:AWSOpenTelemetryDistroJs:<version>
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

// OpenTelemetry community collector-only layer for ExecutionOtelPlugin functions (us-west-2 default)
const OTEL_COLLECTOR_LAYER_ARN =
  "arn:aws:lambda:us-west-2:184161586896:layer:opentelemetry-collector-amd64-0_22_0:1";

// Configuration for different examples that need special settings
const EXAMPLE_CONFIGS: Record<string, any> = {
  "steps-with-retry": {
    memorySize: 256,
    timeout: 300,
    policies: [
      {
        DynamoDBReadPolicy: {
          TableName: "TEST",
        },
      },
    ],
  },
};

// Functions whose log groups already exist in AWS and should not be re-created
// by CloudFormation (avoids "already exists" conflicts on deploy).
const SKIP_LOG_GROUP_CREATION: Set<string> = new Set([
  "otel-community-collector-execution-xray-e2e",
  "otel-community-collector-invocation-xray-e2e",
]);

// Default configuration for Lambda functions
const DEFAULT_CONFIG = {
  memorySize: 128,
  timeout: 60,
  policies: [],
};
const INTEGRATION_TEST_LOG_RETENTION_DAYS = 7;

interface FunctionNameConfig {
  functionName: string;
}

interface TemplateOptions {
  awsRegion?: string;
  codeUri?: string;
  functionNameMap?: Record<string, FunctionNameConfig>;
  lambdaEndpoint?: string;
  lambdaExecutionRoleArn?: string;
  outputTemplateFile?: string;
  runtime?: string;
  skipVerboseLogging?: boolean;
}

/**
 * Convert kebab-case filename to PascalCase resource name
 */
function toPascalCase(filename: string) {
  return filename
    .split("-")
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

function toLambdaRuntime(runtime = "22.x") {
  return `nodejs${runtime}`;
}

function getDefaultFunctionName(catalog: any, runtime = "22.x") {
  const lambdaRuntime = runtime.replace(".", "");
  return `${catalog.name.replace(/\s/g, "")}-${lambdaRuntime}-NodeJS-Local`;
}

function getAdotLayerArn(region = "us-west-2") {
  const adotArn = ADOT_LAYER_ARNS[region];
  if (!adotArn) {
    throw new Error(
      `Unsupported region "${region}" for ADOT Lambda layer. ` +
        `Supported regions: ${Object.keys(ADOT_LAYER_ARNS).join(", ")}`,
    );
  }
  return adotArn;
}

/**
 * Create a Lambda function resource configuration
 */
function createFunctionResource(
  catalog: any,
  functionName: string,
  options: TemplateOptions = {},
) {
  const handlerFile = catalog.handler?.replace(/\.handler$/, "");
  const config =
    EXAMPLE_CONFIGS[handlerFile] ||
    EXAMPLE_CONFIGS[catalog.name] ||
    EXAMPLE_CONFIGS[functionName] ||
    DEFAULT_CONFIG;
  const lambdaEndpoint =
    options.lambdaEndpoint ??
    (options.lambdaExecutionRoleArn
      ? undefined
      : "http://host.docker.internal:5000");
  const environmentVariables: Record<string, string> = {
    DURABLE_VERBOSE_MODE: "false",
    DURABLE_EXAMPLES_VERBOSE: options.skipVerboseLogging ? "false" : "true",
  };

  if (lambdaEndpoint) {
    environmentVariables.AWS_ENDPOINT_URL_LAMBDA = lambdaEndpoint;
  }

  const functionResource: Record<string, any> = {
    Type: "AWS::Serverless::Function",
    Properties: {
      FunctionName: functionName,
      CodeUri: options.codeUri ?? "./dist",
      Handler: catalog.handler,
      Runtime: toLambdaRuntime(options.runtime),
      Architectures: ["x86_64"],
      MemorySize: config.memorySize,
      Timeout: catalog.lambdaTimeoutSeconds ?? config.timeout,
      DurableConfig: catalog.durableConfig,
      Role: options.lambdaExecutionRoleArn ?? {
        "Fn::GetAtt": ["DurableFunctionRole", "Arn"],
      },
      Environment: {
        Variables: environmentVariables,
      },
    },
    Metadata: {
      SkipBuild: "True", // Use string 'True' to match original template format
    },
  };

  // Add policies if specified
  if (
    !options.lambdaExecutionRoleArn &&
    config.policies &&
    config.policies.length > 0
  ) {
    functionResource.Properties.Policies = config.policies;
  }

  // Add ADOT layer and Active Tracing for all otel functions
  if (catalog.handler && catalog.handler.includes("otel-")) {
    functionResource.Properties.Tracing = "Active";
    // Only set exec wrapper for non-community-collector otel functions
    if (!catalog.handler.includes("otel-community-collector")) {
      functionResource.Properties.Layers = [
        getAdotLayerArn(options.awsRegion ?? "us-west-2"),
      ];
      functionResource.Properties.Environment.Variables.AWS_LAMBDA_EXEC_WRAPPER =
        "/opt/otel-instrument";
    } else {
      // ExecutionOtelPlugin: use collector-only layer
      functionResource.Properties.Layers = [OTEL_COLLECTOR_LAYER_ARN];
      functionResource.Properties.Environment.Variables.OPENTELEMETRY_COLLECTOR_CONFIG_URI =
        "/var/task/collector.yaml";
    }
  }

  if (options.functionNameMap && catalog.handler.includes("tenant-target")) {
    functionResource.Properties.TenancyConfig = {
      TenantIsolationMode: "PER_TENANT",
    };
  }

  return functionResource;
}

function getExamplesCatalogJson() {
  const examplesCatalogPath = path.join(
    __dirname,
    "../src/utils/examples-catalog.json",
  );

  if (!fs.existsSync(examplesCatalogPath)) {
    throw new Error(`Examples directory not found: ${examplesCatalogPath}`);
  }

  const examplesCatalog = JSON.parse(
    fs.readFileSync(examplesCatalogPath, "utf8"),
  );

  if (examplesCatalog.length === 0) {
    throw new Error("No TypeScript example files found in src/examples");
  }

  return examplesCatalog;
}

/**
 * Generate the complete CloudFormation template
 */
function generateTemplate(options: TemplateOptions | boolean = {}) {
  const normalizedOptions =
    typeof options === "boolean" ? { skipVerboseLogging: options } : options;
  const examplesCatalog = getExamplesCatalogJson();

  const template: Record<string, any> = {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: "Durable Function examples written in TypeScript.",
    Transform: ["AWS::Serverless-2016-10-31"],
    Resources: {},
  };
  const manageLogGroups = !!normalizedOptions.functionNameMap;

  if (!normalizedOptions.lambdaExecutionRoleArn) {
    template.Resources.DurableFunctionRole = {
      Type: "AWS::IAM::Role",
      Properties: {
        AssumeRolePolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: {
                Service: "lambda.amazonaws.com",
              },
              Action: "sts:AssumeRole",
            },
          ],
        },
        ManagedPolicyArns: [
          "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          "arn:aws:iam::aws:policy/CloudWatchLambdaApplicationSignalsExecutionRolePolicy",
        ],
        Policies: [
          {
            PolicyName: "DurableExecutionPolicy",
            PolicyDocument: {
              Version: "2012-10-17",
              Statement: [
                {
                  Effect: "Allow",
                  Action: [
                    "lambda:CheckpointDurableExecution",
                    "lambda:GetDurableExecutionState",
                  ],
                  Resource: "*",
                },
              ],
            },
          },
        ],
      },
    };
  }

  // Generate resources for each example file
  examplesCatalog
    .filter(
      (catalog: { excludeRuntimes?: string[]; localOnly?: boolean }) =>
        !catalog.localOnly &&
        !catalog.excludeRuntimes?.includes(normalizedOptions.runtime ?? "22.x"),
    )
    .forEach((catalog: { name: string; handler: string }) => {
      const handlerFile = catalog.handler.replace(/\.handler$/, "");
      const functionName =
        normalizedOptions.functionNameMap?.[handlerFile]?.functionName ??
        getDefaultFunctionName(catalog, normalizedOptions.runtime);
      const functionResourceName = toPascalCase(handlerFile);
      const logGroupResourceName = `${functionResourceName}LogGroup`;
      const functionResource = createFunctionResource(
        catalog,
        functionName,
        normalizedOptions,
      );

      if (manageLogGroups && !SKIP_LOG_GROUP_CREATION.has(handlerFile)) {
        template.Resources[logGroupResourceName] = {
          Type: "AWS::Logs::LogGroup",
          Properties: {
            LogGroupName: `/aws/lambda/${functionName}`,
            RetentionInDays: INTEGRATION_TEST_LOG_RETENTION_DAYS,
          },
        };

        functionResource.DependsOn = logGroupResourceName;
      }

      template.Resources[functionResourceName] = functionResource;
    });

  return template;
}

function getArgValue(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function loadFunctionNameMap(filePath?: string) {
  if (!filePath) {
    return undefined;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getMainOptions(args: string[]): TemplateOptions {
  const functionNameMapFile = getArgValue(args, "--function-name-map-file");

  return {
    awsRegion: getArgValue(args, "--aws-region") ?? "us-west-2",
    codeUri: getArgValue(args, "--code-uri"),
    functionNameMap: loadFunctionNameMap(functionNameMapFile),
    lambdaEndpoint:
      getArgValue(args, "--lambda-endpoint") ?? process.env.LAMBDA_ENDPOINT,
    lambdaExecutionRoleArn:
      getArgValue(args, "--lambda-execution-role-arn") ??
      process.env.LAMBDA_EXECUTION_ROLE_ARN,
    outputTemplateFile: getArgValue(args, "--output-template-file"),
    runtime: getArgValue(args, "--runtime") ?? "22.x",
    skipVerboseLogging: args.includes("--skip-verbose-logging"),
  };
}

/**
 * Main function to generate and write the template.yml file
 */
function main() {
  const options = getMainOptions(process.argv.slice(2));

  try {
    console.log("Scanning src/examples for TypeScript files...");

    const template = generateTemplate(options);
    const functionCount = Object.values(template.Resources).filter(
      (resource: any) => resource.Type === "AWS::Serverless::Function",
    ).length;

    console.log(`Found ${functionCount} example functions:`);
    Object.entries(template.Resources).forEach(([resourceName, resource]) => {
      const typedResource = resource as Record<string, any>;
      if (typedResource.Type !== "AWS::Serverless::Function") {
        return;
      }
      console.log(`   - ${resourceName} (${typedResource.Properties.Handler})`);
    });

    // Convert to YAML with proper formatting
    const yamlContent = yaml.dump(template, {
      indent: 2,
      lineWidth: -1, // No line wrapping
      noRefs: true,
      sortKeys: false,
      quotingType: '"',
    });

    const templatePath =
      options.outputTemplateFile ?? path.join(__dirname, "../template.yml");
    fs.mkdirSync(path.dirname(templatePath), { recursive: true });
    fs.writeFileSync(templatePath, yamlContent, "utf8");

    console.log(
      `Generated template.yml with ${functionCount} Lambda functions`,
    );
    console.log(`Template written to: ${templatePath}`);
    if (options.skipVerboseLogging) {
      console.log("Verbose logging disabled");
    }
  } catch (error: any) {
    console.error("Error generating template.yml:", error.message);
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  main();
}

export {
  generateTemplate,
  toPascalCase,
  createFunctionResource,
  getExamplesCatalogJson,
};
