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
          RetentionPeriodInDays: 7,
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
        "hello-world",
        getExamplesCatalogJson()[0],
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
        "steps-with-retry",
        getExamplesCatalogJson()[1],
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
      const resource = createFunctionResource("hello-world", {});

      expect(resource.Properties.Environment.Variables).toEqual({
        AWS_ENDPOINT_URL_LAMBDA: "http://host.docker.internal:5000",
        DURABLE_VERBOSE_MODE: "false",
        DURABLE_EXAMPLES_VERBOSE: "true",
      });
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
  });
});
