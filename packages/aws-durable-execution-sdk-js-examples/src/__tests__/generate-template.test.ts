const { 
  toPascalCase, 
  getExampleFiles, 
  createFunctionResource,
  generateTemplate 
} = require('../../scripts/generate-template.js');

describe('generate-template', () => {
  describe('toPascalCase', () => {
    test('converts kebab-case to PascalCase', () => {
      expect(toPascalCase('hello-world')).toBe('HelloWorld');
      expect(toPascalCase('steps-with-retry')).toBe('StepsWithRetry');
      expect(toPascalCase('wait-for-callback')).toBe('WaitForCallback');
      expect(toPascalCase('single')).toBe('Single');
    });
  });

  describe('createFunctionResource', () => {
    test('creates default function resource', () => {
      const resource = createFunctionResource('hello-world');
      
      expect(resource.Type).toBe('AWS::Serverless::Function');
      expect(resource.Properties.FunctionName).toBe('HelloWorld-TypeScript');
      expect(resource.Properties.Handler).toBe('hello-world.handler');
      expect(resource.Properties.Runtime).toBe('nodejs22.x');
      expect(resource.Properties.MemorySize).toBe(128);
      expect(resource.Properties.Timeout).toBe(60);
      expect(resource.Metadata.SkipBuild).toBe('True');
    });

    test('creates function resource with custom config for steps-with-retry', () => {
      const resource = createFunctionResource('steps-with-retry');
      
      expect(resource.Properties.FunctionName).toBe('StepsWithRetry-TypeScript');
      expect(resource.Properties.MemorySize).toBe(256);
      expect(resource.Properties.Timeout).toBe(300);
      expect(resource.Properties.Policies).toEqual([
        {
          DynamoDBReadPolicy: {
            TableName: 'TEST'
          }
        }
      ]);
    });

    test('includes required environment variables', () => {
      const resource = createFunctionResource('hello-world');
      
      expect(resource.Properties.Environment.Variables).toEqual({
        AWS_ENDPOINT_URL_LAMBDA: 'http://host.docker.internal:5000',
        DURABLE_VERBOSE_MODE: 'true',
      });
    });
  });

  describe('generateTemplate', () => {
    test('generates complete CloudFormation template', () => {
      const template = generateTemplate();
      
      expect(template.AWSTemplateFormatVersion).toBe('2010-09-09');
      expect(template.Description).toBe('Durable Function examples written in TypeScript.');
      expect(template.Transform).toEqual(['AWS::Serverless-2016-10-31']);
      expect(template.Resources).toBeDefined();
      
      // Should have resources for all example files
      const resourceNames = Object.keys(template.Resources);
      expect(resourceNames.length).toBeGreaterThan(0);
      
      // Each resource should be a Lambda function
      resourceNames.forEach(name => {
        expect(template.Resources[name].Type).toBe('AWS::Serverless::Function');
      });
    });
  });
});
