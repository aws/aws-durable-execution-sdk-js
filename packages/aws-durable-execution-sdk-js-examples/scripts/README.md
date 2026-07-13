# Scripts

This directory contains build and automation scripts for the DurableExecutionsTypeScriptExamples package.

## generate-sam-template.ts

Automatically generates the `template.yml` CloudFormation template based on TypeScript files found in `src/examples/`.

### How it works

1. **Scans** the `src/examples/` directory for `.ts` files (excluding test files)
2. **Converts** each filename from kebab-case to PascalCase for AWS resource names
3. **Generates** AWS SAM Lambda function resources with appropriate configuration
4. **Writes** the complete CloudFormation template to `template.yml`

### Usage

```bash
# Run manually
npm run generate-sam-template

# Generate the CI template used by integration tests
npm run generate-sam-template -- \
  --runtime 24.x \
  --aws-region us-west-2 \
  --code-uri ../dist \
  --lambda-execution-role-arn arn:aws:iam::123456789012:role/example-role \
  --function-name-map-file .aws-sam/function-name-map-24x.json \
  --output-template-file .aws-sam/integration-template-24x.yml

# Automatically runs during build (via prebuild hook)
npm run build
```

### Configuration

The script supports custom configurations for specific examples via the `EXAMPLE_CONFIGS` object:

```javascript
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
```

### Default Configuration

All Lambda functions get these default settings unless overridden:

- **Memory**: 128 MB
- **Timeout**: 60 seconds
- **Runtime**: nodejs22.x by default, configurable with `--runtime`
- **Architecture**: x86_64
- **Environment Variables**:
  - `AWS_ENDPOINT_URL_LAMBDA`: `http://host.docker.internal:5000` for local templates, or the `--lambda-endpoint` value when provided
  - `DURABLE_VERBOSE_MODE`: `false`
  - `DURABLE_EXAMPLES_VERBOSE`: `true`

### Adding New Examples

When you add a new TypeScript file to `src/examples/`:

1. The file will automatically be included in the next build
2. A corresponding Lambda function resource will be generated
3. The resource name will be the filename converted to PascalCase
4. If special configuration is needed, add it to `EXAMPLE_CONFIGS`

### Example

For a file named `my-new-example.ts`:

- **Resource Name**: `MyNewExample`
- **Function Name**: generated from the example catalog name and runtime
- **Handler**: `my-new-example.handler`

### Integration with Build Process

The script is integrated into the build process via the `prebuild` npm script:

```json
{
  "scripts": {
    "prebuild": "rm -rf build/durable-executions-typescript-sdk-examples && npm run generate-sam-template"
  }
}
```

This ensures the template is always up-to-date before building the project.
