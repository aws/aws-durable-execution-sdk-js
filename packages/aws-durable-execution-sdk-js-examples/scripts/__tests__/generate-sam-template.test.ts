import {
  toPascalCase,
  createFunctionResource,
  generateTemplate,
  getExamplesCatalogJson,
} from "../generate-sam-template";

jest.mock("fs", () => ({
  existsSync: jest.fn(() => true),
  readFileSync: jest.fn(() =>
    JSON.stringify([
      {
        name: "hello-world",
        description: "A simple hello world example with no durable operations",
        path: "aws-durable-execution-sdk-js/packages/aws-durable-execution-sdk-js-examples/src/examples/hello-world/hello-world.ts",
        handler: "hello-world.handler",
        durableConfig: {
          ExecutionTimeout: 60,
          RetentionPeriodInDays: 7,
        },
      },
      {
        name: "steps-with-retry",
        description: "An example demonstrating retry functionality with steps",
        path: "aws-durable-execution-sdk-js/packages/aws-durable-execution-sdk-js-examples/src/examples/step/steps-with-retry/steps-with-retry.ts",
        handler: "steps-with-retry.handler",
        durableConfig: {
          ExecutionTimeout: 60,
          // Keep this different from log retention to verify they are independent.
          RetentionPeriodInDays: 30,
        },
      },
    ]),
  ),
}));

describe("generate-sam-template", () => {
  describe("toPascalCase", () => {
    test("converts kebab-case to PascalCase", () => {
      expect(toPascalCase("hello-world")).toBe("HelloWorld");
      expect(toPascalCase("steps-with-retry")).toBe("StepsWithRetry");
      expect(toPascalCase("wait-for-callback")).toBe("WaitForCallback");
      expect(toPascalCase("single")).toBe("Single");
    });
  });

  describe("createFunctionResource", () => {
    test("creates default function resource", () => {
      const resource = createFunctionResource(
        getExamplesCatalogJson()[0],
        "hello-world",
      );

      expect(resource.Type).toBe("AWS::Serverless::Function");
      expect(resource.Properties.FunctionName).toBe("hello-world");
      expect(resource.Properties.Handler).toBe("hello-world.handler");
      expect(resource.Properties.Runtime).toBe("nodejs22.x");
      expect(resource.Properties.MemorySize).toBe(128);
      expect(resource.Properties.Timeout).toBe(60);
      expect(resource.Metadata.SkipBuild).toBe("True");
    });

    test("creates function resource with custom config for steps-with-retry", () => {
      const resource = createFunctionResource(
        getExamplesCatalogJson()[1],
        "steps-with-retry",
      );

      expect(resource.Properties.FunctionName).toBe("steps-with-retry");
      expect(resource.Properties.MemorySize).toBe(256);
      expect(resource.Properties.Timeout).toBe(300);
      expect(resource.Properties.Policies).toEqual([
        {
          DynamoDBReadPolicy: {
            TableName: "TEST",
          },
        },
      ]);
    });

    test("includes required environment variables", () => {
      const resource = createFunctionResource(
        getExamplesCatalogJson()[0],
        "hello-world",
      );

      expect(resource.Properties.Environment.Variables).toEqual({
        AWS_ENDPOINT_URL_LAMBDA: "http://host.docker.internal:5000",
        DURABLE_VERBOSE_MODE: "false",
        DURABLE_EXAMPLES_VERBOSE: "true",
      });
    });

    test("uses CI options when provided", () => {
      const resource = createFunctionResource(
        getExamplesCatalogJson()[0],
        "HelloWorld-24x-NodeJS",
        {
          codeUri: "../dist",
          lambdaEndpoint: "https://lambda.us-west-2.amazonaws.com",
          lambdaExecutionRoleArn:
            "arn:aws:iam::123456789012:role/test-lambda-role",
          runtime: "24.x",
        },
      );

      expect(resource.Properties.CodeUri).toBe("../dist");
      expect(resource.Properties.FunctionName).toBe("HelloWorld-24x-NodeJS");
      expect(resource.Properties.Role).toBe(
        "arn:aws:iam::123456789012:role/test-lambda-role",
      );
      expect(resource.Properties.Runtime).toBe("nodejs24.x");
      expect(resource.Properties.Environment.Variables).toEqual({
        AWS_ENDPOINT_URL_LAMBDA: "https://lambda.us-west-2.amazonaws.com",
        DURABLE_VERBOSE_MODE: "false",
        DURABLE_EXAMPLES_VERBOSE: "true",
      });
    });

    test("keeps example config with CI function names", () => {
      const resource = createFunctionResource(
        getExamplesCatalogJson()[1],
        "StepswithRetry-24x-NodeJS",
        {
          lambdaExecutionRoleArn:
            "arn:aws:iam::123456789012:role/test-lambda-role",
          runtime: "24.x",
        },
      );

      expect(resource.Properties.MemorySize).toBe(256);
      expect(resource.Properties.Timeout).toBe(300);
      expect(resource.Properties.Policies).toBeUndefined();
    });
  });

  describe("generateTemplate", () => {
    test("generates complete CloudFormation template", () => {
      const template = generateTemplate();

      expect(template.AWSTemplateFormatVersion).toBe("2010-09-09");
      expect(template.Description).toBe(
        "Durable Function examples written in TypeScript.",
      );
      expect(template.Transform).toEqual(["AWS::Serverless-2016-10-31"]);
      expect(template.Resources).toBeDefined();

      // Should have resources for all example files
      const resourceNames = Object.keys(template.Resources);
      expect(resourceNames.length).toBeGreaterThan(0);

      // Each resource except DurableFunctionRole should be a Lambda function
      resourceNames.forEach((name) => {
        if (name !== "DurableFunctionRole") {
          expect(template.Resources[name].Type).toBe(
            "AWS::Serverless::Function",
          );
        }
      });
    });

    test("generates CI template with explicit function names and log groups", () => {
      const template = generateTemplate({
        codeUri: "../dist",
        functionNameMap: {
          "hello-world": {
            functionName: "HelloWorld-24x-NodeJS",
          },
          "steps-with-retry": {
            functionName: "StepswithRetry-24x-NodeJS",
          },
        },
        lambdaExecutionRoleArn:
          "arn:aws:iam::123456789012:role/test-lambda-role",
        runtime: "24.x",
      });

      expect(template.Resources.DurableFunctionRole).toBeUndefined();
      expect(template.Resources.HelloWorld.Properties.FunctionName).toBe(
        "HelloWorld-24x-NodeJS",
      );
      expect(template.Resources.HelloWorld.Properties.CodeUri).toBe("../dist");
      expect(template.Resources.HelloWorld.Properties.Runtime).toBe(
        "nodejs24.x",
      );
      expect(template.Resources.HelloWorld.DependsOn).toBe(
        "HelloWorldLogGroup",
      );
      expect(template.Resources.HelloWorldLogGroup).toEqual({
        Type: "AWS::Logs::LogGroup",
        Properties: {
          LogGroupName: "/aws/lambda/HelloWorld-24x-NodeJS",
          RetentionInDays: 7,
        },
      });
      expect(template.Resources.StepsWithRetry.Properties.MemorySize).toBe(
        256,
      );
      expect(template.Resources.StepsWithRetry.Properties.Timeout).toBe(300);
      expect(template.Resources.StepsWithRetryLogGroup.Properties).toEqual({
        LogGroupName: "/aws/lambda/StepswithRetry-24x-NodeJS",
        RetentionInDays: 7,
      });
    });
  });
});
