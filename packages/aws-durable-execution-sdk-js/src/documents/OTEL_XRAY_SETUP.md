# OTel + X-Ray on AWS Lambda Durable Executions — Setup Guide and Lessons Learned

## Overview

This document describes how to instrument a durable Lambda function with OpenTelemetry and send traces to AWS X-Ray. It covers the working setup, the edge cases discovered during implementation, and the lessons learned.

---

## What You Need

### 1. OTel packages

```bash
npm install \
  @opentelemetry/api \
  @opentelemetry/sdk-trace-node \
  @opentelemetry/exporter-trace-otlp-grpc \
  @opentelemetry/id-generator-aws-xray \
  @opentelemetry/propagator-aws-xray \
  @grpc/grpc-js
```

### 2. ADOT Lambda Layer

Find the correct ARN for your region at: https://aws-otel.github.io/docs/getting-started/lambda/lambda-js

### 3. IAM permissions

```yaml
ManagedPolicyArns:
  - arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess
```

### 4. Lambda configuration

```yaml
Tracing: Active
Layers:
  - arn:aws:lambda:us-east-1:901920570463:layer:aws-otel-nodejs-amd64-ver-1-30-1:1
Environment:
  Variables:
    OPENTELEMETRY_COLLECTOR_CONFIG_URI: /var/task/collector.yaml
```

### 5. ADOT collector config (`collector.yaml`)

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: "localhost:4317"

exporters:
  awsxray:
    region: "us-east-1" # must be hardcoded — ${AWS_REGION} is NOT expanded

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [awsxray]
```

---

## Working Code

### `tracing.ts`

```typescript
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { AWSXRayIdGenerator } from "@opentelemetry/id-generator-aws-xray";
import { AWSXRayPropagator } from "@opentelemetry/propagator-aws-xray";
import { credentials } from "@grpc/grpc-js";

const exporter = new OTLPTraceExporter({
  url: "localhost:4317",
  credentials: credentials.createInsecure(),
});

export const provider = new NodeTracerProvider({
  idGenerator: new AWSXRayIdGenerator(),
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

provider.register({ propagator: new AWSXRayPropagator() });
```

### `handler.ts`

```typescript
import { provider } from "./tracing";
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import {
  propagation,
  context as otelContext,
  ROOT_CONTEXT,
} from "@opentelemetry/api";

const durableHandler = withDurableExecution(async (event, context) => {
  const greeting = await context.step(
    "greet",
    async () => `Hello, ${event.name}!`,
  );
  await context.wait({ seconds: 2 });
  return await context.step("finalize", async () => ({ message: greeting }));
});

export const handler = async (event: any, lambdaContext: any) => {
  // CRITICAL: Extract X-Ray trace context per invocation
  const xrayTraceId = process.env._X_AMZN_TRACE_ID;
  const parentContext = xrayTraceId
    ? propagation.extract(ROOT_CONTEXT, { "x-amzn-trace-id": xrayTraceId })
    : ROOT_CONTEXT;

  return otelContext.with(parentContext, async () => {
    try {
      return await durableHandler(event, lambdaContext);
    } finally {
      await provider.forceFlush();
    }
  });
};
```

---

## Edge Cases and Lessons Learned

### 1. `BatchSpanProcessor` silently drops spans in Lambda

**Fix:** Use `SimpleSpanProcessor`. It exports each span synchronously on `span.end()`. Combined with `forceFlush()` in the handler's `finally` block, spans are reliably exported before Lambda freezes.

### 2. gRPC requires `credentials.createInsecure()`

The ADOT collector in Lambda runs without TLS. The gRPC exporter defaults to TLS, causing `SSL routines: wrong version number` errors.

**Fix:**

```typescript
credentials: credentials.createInsecure();
```

### 3. `${AWS_REGION}` is not expanded in `collector.yaml`

**Fix:** Hardcode the region in `collector.yaml`.

### 4. OTel as a `dependency` causes isolated module instances

If `@opentelemetry/api` is listed as a `dependency` in the SDK's `package.json`, npm may install it as a nested `node_modules`. The SDK's spans become no-ops.

**Fix:** Make `@opentelemetry/api` a `peerDependency` and mark it as `external` in the rollup config.

### 5. `.gitignore` blocks `dist/` from npm pack

**Fix:** Add a `.npmignore` file that explicitly lists what to exclude.

### 6. Spans split across traces without `_X_AMZN_TRACE_ID` extraction

The durable execution backend propagates the same `Root` traceId to every invocation via `traceFields`. But without explicitly extracting `_X_AMZN_TRACE_ID` per invocation, each invocation creates a new root span with a new `traceId`.

**Fix:** Extract `_X_AMZN_TRACE_ID` inside the handler (not at module load) on every invocation.

### 7. `npm install` caches old `.tgz` integrity hashes

**Fix:** Delete `package-lock.json` before reinstalling when the `.tgz` content has changed.
