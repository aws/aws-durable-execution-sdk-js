#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Configuration for different examples that need special settings
const EXAMPLE_CONFIGS = {
  'steps-with-retry': {
    memorySize: 256,
    timeout: 300,
    policies: [
      {
        DynamoDBReadPolicy: {
          TableName: 'TEST'
        }
      }
    ]
  }
};

// Default configuration for Lambda functions
const DEFAULT_CONFIG = {
  memorySize: 128,
  timeout: 60,
  policies: []
};

/**
 * Convert kebab-case filename to PascalCase resource name
 */
function toPascalCase(filename) {
  return filename
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * Get TypeScript files from src/examples directory
 */
function getExampleFiles() {
  const examplesDir = path.join(__dirname, '../src/examples');
  
  if (!fs.existsSync(examplesDir)) {
    throw new Error(`Examples directory not found: ${examplesDir}`);
  }

  return fs.readdirSync(examplesDir)
    .filter(file => file.endsWith('.ts') && !file.includes('.test.') && !file.includes('.spec.'))
    .map(file => path.basename(file, '.ts'))
    .sort(); // Sort for consistent output
}

/**
 * Create a Lambda function resource configuration
 */
function createFunctionResource(filename) {
  const resourceName = toPascalCase(filename);
  const config = EXAMPLE_CONFIGS[filename] || DEFAULT_CONFIG;
  
  const functionResource = {
    Type: 'AWS::Serverless::Function',
    Properties: {
      FunctionName: `${resourceName}-TypeScript`,
      CodeUri: './build/durable-executions-typescript-sdk-examples',
      Handler: `${filename}.handler`,
      Runtime: 'nodejs22.x',
      Architectures: ['x86_64'],
      MemorySize: config.memorySize,
      Timeout: config.timeout,
      Environment: {
        Variables: {
          DEX_ENDPOINT: 'http://host.docker.internal:5000',
          DURABLE_VERBOSE_MODE: 'true',
          DURABLE_RECORD_DEFINITION_MODE: 'true'
        }
      }
    },
    Metadata: {
      SkipBuild: 'True' // Use string 'True' to match original template format
    }
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
function generateTemplate() {
  const exampleFiles = getExampleFiles();
  
  if (exampleFiles.length === 0) {
    throw new Error('No TypeScript example files found in src/examples');
  }

  const template = {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Durable Function examples written in TypeScript.',
    Transform: ['AWS::Serverless-2016-10-31'],
    Resources: {}
  };

  // Generate resources for each example file
  exampleFiles.forEach(filename => {
    const resourceName = toPascalCase(filename);
    template.Resources[resourceName] = createFunctionResource(filename);
  });

  return template;
}

/**
 * Main function to generate and write the template.yml file
 */
function main() {
  try {
    console.log('🔍 Scanning src/examples for TypeScript files...');
    
    const template = generateTemplate();
    const exampleCount = Object.keys(template.Resources).length;
    
    console.log(`📝 Found ${exampleCount} example files:`);
    Object.keys(template.Resources).forEach(resourceName => {
      const handler = template.Resources[resourceName].Properties.Handler;
      console.log(`   - ${resourceName} (${handler})`);
    });

    // Convert to YAML with proper formatting
    const yamlContent = yaml.dump(template, {
      indent: 2,
      lineWidth: -1, // No line wrapping
      noRefs: true,
      sortKeys: false
    });

    // Write to template.yml
    const templatePath = path.join(__dirname, '../template.yml');
    fs.writeFileSync(templatePath, yamlContent, 'utf8');
    
    console.log(`✅ Generated template.yml with ${exampleCount} Lambda functions`);
    console.log(`📄 Template written to: ${templatePath}`);
    
  } catch (error) {
    console.error('❌ Error generating template.yml:', error.message);
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
  createFunctionResource
};
