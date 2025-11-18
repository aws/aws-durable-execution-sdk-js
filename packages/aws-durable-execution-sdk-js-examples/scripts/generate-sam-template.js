#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

// Configuration for different examples that need special settings
const EXAMPLE_CONFIGS = {
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
function toPascalCase(filename) {
  return filename
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/**
 * Get TypeScript files from src/examples directory
 */
function getExampleFiles() {
  const examplesDir = path.join(__dirname, "../src/examples");

  if (!fs.existsSync(examplesDir)) {
    throw new Error(`Examples directory not found: ${examplesDir}`);
  }

  const exampleFiles = [];

  // Read all directories in examples
  const entries = fs.readdirSync(examplesDir, { withFileTypes: true });

  for (const entry of entries) {
    // Skip non-directories and special directories
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const dirPath = path.join(examplesDir, entry.name);
    const subEntries = fs.readdirSync(dirPath, { withFileTypes: true });

    // Check if this directory contains TypeScript files directly (standalone examples)
    const directTsFiles = subEntries.filter(
      (dirent) =>
        dirent.isFile() &&
        dirent.name.endsWith(".ts") &&
        !dirent.name.includes(".test"),
    );

    if (directTsFiles.length > 0) {
      // Standalone example directory
      directTsFiles.forEach((file) => {
        exampleFiles.push(path.basename(file.name, ".ts"));
      });
    } else {
      // Nested structure - scan subdirectories
      const subDirs = subEntries.filter((dirent) => dirent.isDirectory());

      for (const subDir of subDirs) {
        const subDirPath = path.join(dirPath, subDir.name);
        const filesInSubDir = fs.readdirSync(subDirPath);

        // Find TypeScript files (excluding test files)
        const tsFiles = filesInSubDir.filter(
          (file) => file.endsWith(".ts") && !file.includes(".test."),
        );

        // Add each example file (without .ts extension)
        tsFiles.forEach((file) => {
          exampleFiles.push(path.basename(file, ".ts"));
        });
      }
    }
  }

  return exampleFiles.sort(); // Sort for consistent output
}

/**
 * Create a Lambda function resource configuration
 */
function createFunctionResource(filename, skipVerboseLogging = false) {
  const resourceName = toPascalCase(filename);
  const config = EXAMPLE_CONFIGS[filename] || DEFAULT_CONFIG;

  const functionResource = {
    Type: "AWS::Serverless::Function",
    Properties: {
      FunctionName: `${resourceName}-TypeScript`,
      CodeUri: "./dist",
      Handler: `${filename}.handler`,
      Runtime: "nodejs22.x",
      Architectures: ["x86_64"],
      MemorySize: config.memorySize,
      Timeout: config.timeout,
      Role: { "Fn::GetAtt": ["DurableFunctionRole", "Arn"] },
      DurableConfig: {
        ExecutionTimeout: 3600,
        RetentionPeriodInDays: 7,
      },
      Environment: {
        Variables: {
          AWS_ENDPOINT_URL_LAMBDA: "http://host.docker.internal:5000",
          DURABLE_VERBOSE_MODE: skipVerboseLogging ? "false" : "true",
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

/**
 * Generate the complete CloudFormation template
 */
function generateTemplate(skipVerboseLogging = false) {
  const exampleFiles = getExampleFiles();

  if (exampleFiles.length === 0) {
    throw new Error("No TypeScript example files found in src/examples");
  }

  const template = {
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
  exampleFiles.forEach((filename) => {
    const resourceName = toPascalCase(filename);
    template.Resources[resourceName] = createFunctionResource(
      filename,
      skipVerboseLogging,
    );
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
  } catch (error) {
    console.error("❌ Error generating template.yml:", error.message);
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  main();
}

module.exports = {
  generateTemplate,
  getExampleFiles,
  toPascalCase,
  createFunctionResource,
};
