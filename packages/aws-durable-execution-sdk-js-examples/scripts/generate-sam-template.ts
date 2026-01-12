#!/usr/bin/env node

import fs from "fs";
import path from "path";
import yaml from "js-yaml";

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

// Default configuration for Lambda functions
const DEFAULT_CONFIG = {
  memorySize: 128,
  timeout: 60,
  policies: [],
};

/**
 * Convert kebab-case filename to PascalCase resource name
 */
function toPascalCase(filename: string) {
  return filename
    .split("-")
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/**
 * Create a Lambda function resource configuration
 */
function createFunctionResource(
  resourceName: string,
  catalog: any,
  skipVerboseLogging = false,
) {
  const config = EXAMPLE_CONFIGS[resourceName] || DEFAULT_CONFIG;

  const functionResource: Record<string, any> = {
    Type: "AWS::Serverless::Function",
    Properties: {
      FunctionName: resourceName,
      CodeUri: "./dist",
      Handler: catalog.handler,
      Runtime: "nodejs22.x",
      Architectures: ["x86_64"],
      MemorySize: config.memorySize,
      Timeout: config.timeout,
      Role: { "Fn::GetAtt": ["DurableFunctionRole", "Arn"] },
      DurableConfig: catalog.durableConfig,
      Environment: {
        Variables: {
          AWS_ENDPOINT_URL_LAMBDA: "http://host.docker.internal:5000",
          DURABLE_VERBOSE_MODE: "false",
          DURABLE_EXAMPLES_VERBOSE: "true",
        },
      },
    },
    Metadata: {
      SkipBuild: "True", // Use string 'True' to match original template format
    },
  };

  // Add policies if specified
  if (config.policies && config.policies.length > 0) {
    functionResource.Properties.Policies = config.policies;
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
function generateTemplate(skipVerboseLogging = false) {
  const examplesCatalog = getExamplesCatalogJson();

  const template: Record<string, any> = {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: "Durable Function examples written in TypeScript.",
    Transform: ["AWS::Serverless-2016-10-31"],
    Resources: {
      DurableFunctionRole: {
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
      },
    },
  };

  // Generate resources for each example file
  examplesCatalog.forEach((catalog: { name: string; handler: string }) => {
    const resourceName = catalog.name.replace(/\s/g, "") + `-22x-NodeJS-Local`;
    template.Resources[
      toPascalCase(catalog.handler.slice(0, -".handler".length))
    ] = createFunctionResource(resourceName, catalog, skipVerboseLogging);
  });

  return template;
}

/**
 * Main function to generate and write the template.yml file
 */
function main() {
  const args = process.argv.slice(2);
  const skipVerboseLogging = args.includes("--skip-verbose-logging");

  try {
    console.log("🔍 Scanning src/examples for TypeScript files...");

    const template = generateTemplate(skipVerboseLogging);
    const exampleCount = Object.keys(template.Resources).length;

    console.log(`📝 Found ${exampleCount} example files:`);
    Object.keys(template.Resources).forEach((resourceName) => {
      const handler = template.Resources[resourceName].Properties.Handler;
      console.log(`   - ${resourceName} (${handler})`);
    });

    // Convert to YAML with proper formatting
    const yamlContent = yaml.dump(template, {
      indent: 2,
      lineWidth: -1, // No line wrapping
      noRefs: true,
      sortKeys: false,
      quotingType: '"',
    });

    // Write to template.yml
    const templatePath = path.join(__dirname, "../template.yml");
    fs.writeFileSync(templatePath, yamlContent, "utf8");

    console.log(
      `✅ Generated template.yml with ${exampleCount} Lambda functions`,
    );
    console.log(`📄 Template written to: ${templatePath}`);
    if (skipVerboseLogging) {
      console.log("🔇 Verbose logging disabled");
    }
  } catch (error: any) {
    console.error("❌ Error generating template.yml:", error.message);
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
