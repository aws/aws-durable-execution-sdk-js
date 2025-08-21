# Automatic Template Generation

This project now includes automatic generation of the `template.yml` CloudFormation template based on TypeScript files in the `src/examples/` directory.

## What was implemented

### 1. Generate Template Script (`scripts/generate-template.ts`)

A TypeScript script that:
- Scans `src/examples/` for `.ts` files (excluding test files)
- Converts filenames from kebab-case to PascalCase for AWS resource names
- Generates AWS SAM Lambda function resources with appropriate configuration
- Supports custom configurations for specific examples (like `steps-with-retry`)
- Writes the complete CloudFormation template to `template.yml`
- Includes full TypeScript type definitions for better type safety

### 2. Build Integration

The script is integrated into the build process via the `prebuild` npm script:

```json
{
  "scripts": {
    "prebuild": "rm -rf build/durable-executions-typescript-sdk-examples && npm run generate-template"
  }
}
```

This ensures the template is always up-to-date before building the project.

### 3. Custom Configuration Support

The script supports custom configurations for examples that need special settings:

```typescript
const EXAMPLE_CONFIGS: Record<string, ExampleConfig> = {
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
```

### 4. Testing

Includes comprehensive tests for the script functionality in `src/__tests__/generate-template.test.ts`.

## How to use

### Adding New Examples

1. Create a new TypeScript file in `src/examples/` (e.g., `my-new-example.ts`)
2. The file will automatically be included in the next build
3. A corresponding Lambda function resource will be generated with:
   - **Resource Name**: `MyNewExample` (PascalCase conversion)
   - **Function Name**: `MyNewExample-TypeScript`
   - **Handler**: `my-new-example.handler`

### Manual Generation

```bash
npm run generate-template
```

### Automatic Generation

The template is automatically generated during:
```bash
npm run build
```

### Custom Configuration

If your example needs special configuration (memory, timeout, policies), add it to the `EXAMPLE_CONFIGS` object in `scripts/generate-template.ts`.

## Benefits

1. **No Manual Updates**: Adding new examples no longer requires manually updating `template.yml`
2. **Consistency**: All Lambda functions follow the same naming and configuration patterns
3. **Error Prevention**: Eliminates the risk of forgetting to update the template
4. **Maintainability**: Configuration is centralized and version-controlled
5. **Type Safety**: Full TypeScript support with proper type definitions
6. **IDE Support**: Better IntelliSense and error checking during development

## Files Created/Modified

- ✅ `scripts/generate-template.ts` - Main generation script (TypeScript)
- ✅ `scripts/README.md` - Documentation for the scripts directory
- ✅ `src/__tests__/generate-template.test.ts` - Tests for the script
- ✅ `package.json` - Added `generate-template` script and integrated into `prebuild`
- ✅ `template.yml` - Now automatically generated (includes the new `comprehensive-operations` example)

## Example Output

When you run the script, you'll see:

```
🔍 Scanning src/examples for TypeScript files...
📝 Found 7 example files:
   - BlockExample (block-example.handler)
   - ComprehensiveOperations (comprehensive-operations.handler)
   - HelloWorld (hello-world.handler)
   - ParallelWait (parallel-wait.handler)
   - StepsWithRetry (steps-with-retry.handler)
   - Wait (wait.handler)
   - WaitForCallback (wait-for-callback.handler)
✅ Generated template.yml with 7 Lambda functions
📄 Template written to: /Users/parpooya/workplace/DurableExecutionsLanguageSDK/src/DurableExecutionsTypeScriptExamples/template.yml
```

The generated template maintains the same structure and formatting as the original, ensuring compatibility with existing deployment processes.

## TypeScript Advantages

Converting to TypeScript provides several benefits:

1. **Type Safety**: Compile-time type checking prevents runtime errors
2. **Better IDE Support**: IntelliSense, auto-completion, and refactoring tools
3. **Consistency**: Matches the rest of the project's TypeScript codebase
4. **Maintainability**: Easier to understand and modify with explicit type definitions
5. **Documentation**: Types serve as inline documentation for the code
