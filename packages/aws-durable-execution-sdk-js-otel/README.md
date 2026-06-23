# AWS Durable Execution SDK - OpenTelemetry Plugin

> **⚠️ Experimental Beta:** This plugin is currently in experimental beta. Functionality may change without notice between releases. It is not recommended for production workloads at this time.

OpenTelemetry instrumentation plugin for AWS Durable Execution SDK. Emits distributed traces that correlate across multiple Lambda invocations of a single durable execution, producing deterministic span and trace IDs so that spans from different invocations are stitched into a single coherent trace.

## Features

- **Deterministic Trace IDs**: All invocations of the same durable execution share a single trace, derived from the X-Ray trace header or execution ARN
- **Span-per-Operation**: Each durable operation (step, wait, invoke) gets its own span with accurate timing
- **Continuation Spans**: Operations completing in a different invocation are linked back to the original span
- **Log Correlation**: Enrich application logs with trace ID and span ID for end-to-end observability
- **Configurable Sampling**: Control trace volume via environment variable or plugin options
- **Self-Contained Setup**: No manual TracerProvider configuration required

## Installation

```bash
npm install @aws/durable-execution-sdk-js-otel
```

## Quick Start using Xray/CloudWatch Tracing

1. Add the ADOT Lambda Layer to your function and set `AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-instrument`
2. Enable X-Ray Active Tracing on the function
3. Pass `DurableExecutionOtelPlugin` to your handler's `plugins` array
4. Add Xray Write Permissions

### 1. ADOT Lambda Layer

This plugin requires the [AWS Distro for OpenTelemetry (ADOT) Lambda layer](https://aws-otel.github.io/docs/getting-started/lambda) to export traces from your Lambda function.

The layer ARN follows the format:

```
arn:aws:lambda:<region>:615299751070:layer:AWSOpenTelemetryDistroJs:<version>
```

Refer to the [ADOT Lambda Layer ARNs](https://aws-otel.github.io/docs/getting-started/lambda#aws-lambda-layer-for-opentelemetry-arns) page for the latest version number and supported regions.

**AWS CLI:**

```bash
aws lambda update-function-configuration \
  --function-name your-function-name \
  --layers "arn:aws:lambda:us-east-1:615299751070:layer:AWSOpenTelemetryDistroJs:<version>"
```

You must also set the `AWS_LAMBDA_EXEC_WRAPPER` environment variable:

```bash
aws lambda update-function-configuration \
  --function-name your-function-name \
  --environment "Variables={AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-instrument}"
```

> **Note:** Replace `us-east-1` with your function's region and `<version>` with the latest layer version from the ADOT docs.

**CloudFormation / SAM:**

```yaml
MyFunction:
  Type: AWS::Serverless::Function
  Properties:
    Layers:
      - !Sub arn:aws:lambda:${AWS::Region}:615299751070:layer:AWSOpenTelemetryDistroJs:<version>
    Environment:
      Variables:
        AWS_LAMBDA_EXEC_WRAPPER: /opt/otel-instrument
```

For raw CloudFormation (`AWS::Lambda::Function`):

```yaml
MyFunction:
  Type: AWS::Lambda::Function
  Properties:
    Layers:
      - !Sub arn:aws:lambda:${AWS::Region}:615299751070:layer:AWSOpenTelemetryDistroJs:<version>
    Environment:
      Variables:
        AWS_LAMBDA_EXEC_WRAPPER: /opt/otel-instrument
```

**CDK:**

```typescript
import * as lambda from "aws-cdk-lib/aws-lambda";

const adotLayer = lambda.LayerVersion.fromLayerVersionArn(
  this,
  "AdotLayer",
  `arn:aws:lambda:${this.region}:615299751070:layer:AWSOpenTelemetryDistroJs:<version>`,
);

const fn = new lambda.Function(this, "MyFunction", {
  runtime: lambda.Runtime.NODEJS_22_X,
  handler: "index.handler",
  code: lambda.Code.fromAsset("lambda"),
  layers: [adotLayer],
  environment: {
    AWS_LAMBDA_EXEC_WRAPPER: "/opt/otel-instrument",
  },
});
```

> **Tip:** Pin the layer version to a specific number in production deployments to avoid unexpected behavior from automatic version changes.

### 2. AWS X-Ray Active Tracing

Enable active tracing on your Lambda function so the `_X_AMZN_TRACE_ID` environment variable is populated at invocation time. The plugin uses this header to derive deterministic trace IDs that remain consistent across all invocations of the same durable execution.

**AWS Console:** Lambda → Configuration → Monitoring and operations tools → Active tracing → Enable

**AWS CLI:**

```bash
aws lambda update-function-configuration \
  --function-name your-function-name \
  --tracing-config Mode=Active
```

**CloudFormation / SAM:**

```yaml
MyFunction:
  Type: AWS::Lambda::Function
  Properties:
    TracingConfig:
      Mode: Active
```

**CDK:**

```typescript
new lambda.Function(this, "MyFunction", {
  tracing: lambda.Tracing.ACTIVE,
});
```

### 3. In your Lambda handler (index.js)

```typescript
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { DurableExecutionOtelPlugin } from "@aws/durable-execution-sdk-js-otel";

export const handler = withDurableExecution(
  async (event, context) => {
    const result = await context.step("fetch-data", async () => {
      return fetchData(event.id);
    });

    await context.wait({ seconds: 5 });

    await context.step("process", async () => {
      return process(result);
    });

    return result;
  },
  { plugins: [new DurableExecutionOtelPlugin()] },
);
```

That's it. The plugin handles TracerProvider setup, deterministic ID generation, and span lifecycle internally.

### 4. Grant Permissions

The function's execution role needs the `AWSXRayDaemonWriteAccess` managed policy (or equivalent permissions) if using X-Ray as the tracing backend.

### AWS Console

See https://aws-otel.github.io/docs/getting-started/lambda#use-the-lambda-console.

### Environment Variables for ADOT layer

| Variable                      | Description                                                                                   | Default           |
| ----------------------------- | --------------------------------------------------------------------------------------------- | ----------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Endpoint for the OTLP exporter (e.g., `http://localhost:4318` for the ADOT collector sidecar) | Set by ADOT layer |
| `AWS_LAMBDA_EXEC_WRAPPER`     | Set to `/opt/otel-instrument` for the ADOT layer to instrument your function                  | —                 |
| `OTEL_TRACES_SAMPLER`         | Sampler to use (e.g., `traceidratio` for ratio-based sampling)                                | `always_on`       |
| `OTEL_TRACES_SAMPLER_ARG`     | Argument for the sampler (e.g., `0.3` to sample 30% of traces)                                | —                 |

See the [ADOT sampling configuration](https://aws-otel.github.io/docs/getting-started/lambda#sampling-configuration) for more details.

## Configuration

### Plugin Options

```typescript
import { DurableExecutionOtelPlugin } from "@aws/durable-execution-sdk-js-otel";

const plugin = new DurableExecutionOtelPlugin({
  // Use a custom context extractor (default: xRayContextExtractor)
  contextExtractor?: xRayContextExtractor,

  // Provide your own TracerProvider if you already have one configured
  tracerProvider?: myTracerProvider,

  // Custom instrumentation scope name (default: "aws-durable-execution-sdk-js")
  instrumentationName?: "my-service",
});
```

### Context Extractors

The plugin supports multiple strategies for extracting upstream trace context:

```typescript
import {
  DurableExecutionOtelPlugin,
  xRayContextExtractor,
  w3cClientContextExtractor,
} from "@aws/durable-execution-sdk-js-otel";

// Default: X-Ray trace header (recommended for most Lambda deployments)
new DurableExecutionOtelPlugin({ contextExtractor: xRayContextExtractor });

// W3C Trace Context via clientContext (requires backend propagation support (TODO))
new DurableExecutionOtelPlugin({ contextExtractor: w3cClientContextExtractor });
```

## Verification

After deploying your function with the plugin configured:

1. **Invoke your durable function** — trigger at least one execution that includes multiple steps or a wait/resume cycle.

2. **Check Cloudwatch console** — Navigate to Cloudwatch → Traces in the AWS Console. You should see a trace with:
   - An "invocation" span per invocation
   - Child spans for each durable operation (named after your step names)
   - All invocations of the same execution grouped under one trace ID

3. **Check log correlation** — If you use `enrichLogContext()`, verify that your logs include `traceId` and `spanId` fields matching the spans in X-Ray.

4. **Confirm sampling** — If you set `OTEL_TRACES_SAMPLER=traceidratio` and `OTEL_TRACES_SAMPLER_ARG` to a value less than 1.0, verify that only the expected proportion of traces appear.

5. **span links** — For operations that span multiple invocations (e.g., after a wait resumes), though span links are set, they are not visualized within CloudWatch console.

### Troubleshooting

| Symptom                           | Likely Cause                                                    |
| --------------------------------- | --------------------------------------------------------------- |
| No traces appear                  | ADOT layer not configured, or `AWS_LAMBDA_EXEC_WRAPPER` not set |
| Traces appear but are fragmented  | X-Ray active tracing not enabled on the Lambda function         |
| Missing spans for some operations | `OTEL_TRACES_SAMPLER_ARG` set below 1.0                         |
| `_X_AMZN_TRACE_ID` not populated  | X-Ray active tracing not enabled                                |

## API Reference

### `DurableExecutionOtelPlugin`

The main plugin class. Implements `DurableInstrumentationPlugin` from `@aws/durable-execution-sdk-js`.

```typescript
new DurableExecutionOtelPlugin(config?: DurableExecutionOtelPluginConfig)
```

### `DeterministicIdGenerator`

A custom OpenTelemetry `IdGenerator` that produces reproducible trace and span IDs from execution metadata. Exported for advanced use cases.

### `xRayContextExtractor`

Default context extractor. Reads the `_X_AMZN_TRACE_ID` environment variable to derive trace context.

### `w3cClientContextExtractor`

Alternative context extractor. Reads `traceparent` from `context.clientContext.custom.traceparent` (W3C Trace Context format).

### `ContextExtractor`

Type definition for custom context extractor functions.

## License

Apache-2.0
