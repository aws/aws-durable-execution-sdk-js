# Durable Executions TypeScript Examples

This package contains example applications demonstrating how to use the [Durable Executions Language SDK](https://code.amazon.com/packages/DurableExecutionsLanguageSDK) for TypeScript. These examples showcase various patterns and capabilities of durable functions, including basic operations, promise combinators, retry mechanisms, and callback handling.

## Workspace Setup
```
brazil ws create --name DurableExecutionsSDK --vs DurableExecutions/master
cd DurableExecutionsSDK
brazil ws use -p DurableExecutionsTypeScriptExamples
cd src/DurableExecutionsTypeScriptExamples
brazil-build
```

## Development Workflow
1. Add or modify example functions in `src/examples/`
2. Build: `brazil-build`
3. Invoke functions using the Local Runner or the Staging Environment (instructions below).

**Note:** You do not need to manually update the SAM template -- this is done as part of the build process.

## Deploying Examples in Staging Environment

For testing against the actual Durable Executions service in a staging environment, use the provided deployment script.

### Prerequisites

- `awscurl` installed and configured
- `ada` credentials tool available
- Access to the staging Durable Executions service

### Usage

```bash
./create-lambda.sh --function-name <name> --handler <handler> [options]
```

### Required Arguments

- `--function-name`: Name of the Lambda function to create
- `--handler`: Handler function (e.g., `wait.handler`, `hello-world.handler`)

### Optional Arguments

- `--retention-days`: DurableConfig retention period in days (default: 7)
- `--execution-timeout`: DurableConfig execution timeout in seconds (default: 900 = 15 minutes)
- `--skip-build`: Skip the brazil-build step (useful if the package is already built)

### Examples

Basic deployment:
```bash
./create-lambda.sh --function-name my-hello-world --handler hello-world.handler
```

With custom configuration:
```bash
./create-lambda.sh --function-name my-wait-function --handler wait.handler --retention-days 10 --execution-timeout 600
```

Skip build step (if already built):
```bash
./create-lambda.sh --function-name my-function --handler wait.handler --skip-build
```

### Testing Deployed Functions

After deployment, the script provides an invoke command. You can test your deployed function using:

```bash
awscurl --service lambda --region us-west-2 -X POST https://durable.durable-functions.devo.us-west-2.lambda.aws.a2z.com/2015-03-31/functions/arn%3Aaws%3Alambda%3Aus-west-2%3A269053363128%3Afunction%3A<your-function-name>/invocations -H "X-Amz-Durable-Execution-Name: test-execution-$(date +%s)" -H "X-Amz-Client-Token: client-token-$(date +%s)" -d '{ "Success": true, "key2": "value2" }'
```

## Testing Against Local Runner

For local development and testing, use the Local Runner which emulates the Durable Executions service endpoints locally.

### Prerequisites

- Python 3.x installed
- AWS SAM CLI installed
- Local Runner package available in your workspace

### Setup
1. Pull the local runner package into your local workspace:
   ```
   brazil ws use -p DurableExecutionsLocalRunner
   ```

2. **Start the Local Runner** (Terminal #1):
   ```bash
   cd src/DurableExecutionsLocalRunner
   PYTHONPATH=src LOG=debug brazil-runtime-exec python3 src/durable_executions_local/server.py
   ```
   This starts the local runner on port 5000.


3. **Start the Lambda Server** (Terminal #2):
   ```bash
   cd src/DurableExecutionsTypeScriptExamples
   sam local start-lambda
   ```
   This starts the Lambda server on port 3001.



### Running Examples

With both servers running, invoke durable functions using the Local Runner CLI tool:

```bash
# From the TypeScript Examples directory
cd src/DurableExecutionsTypeScriptExamples

# Invoke a specific function
brazil-runtime-exec python3 ../DurableExecutionsLocalRunner/src/durable_executions_local/cli/invoke.py --function-name HelloWorldFunction
```
