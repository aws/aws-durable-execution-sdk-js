# How AWS X-Ray Uses OpenTelemetry and the IdGenerator Pattern

## Overview

AWS X-Ray is AWS's native distributed tracing service. AWS now provides an OTel-compatible path to X-Ray through the **AWS Distro for OpenTelemetry (ADOT)**. This is directly relevant to our SDK because it demonstrates the `IdGenerator` pattern in production at AWS scale.

---

## X-Ray's Trace ID Format

X-Ray uses a non-standard trace ID format that is incompatible with the default OTel random ID generator:

```
X-Ray format:  1-{8-hex-timestamp}-{24-hex-random}
Example:       1-58406520-a006649127e371903a2de979

OTel format:   {32-hex-random}
Example:       4bf92f3577b34da6a3ce929d0e0e4736
```

X-Ray embeds a Unix timestamp in the first 8 hex characters of the trace ID. Standard OTel random IDs are rejected by X-Ray because they don't contain a valid timestamp in the expected position.

---

## The `AWSXRayIdGenerator` — A Production `IdGenerator` Implementation

To bridge OTel and X-Ray, AWS ships `@opentelemetry/id-generator-aws-xray` — a custom `IdGenerator` that produces X-Ray-compatible trace IDs:

```typescript
import { AWSXRayIdGenerator } from "@opentelemetry/id-generator-aws-xray";

sdk.configureTracerProvider(
  { idGenerator: new AWSXRayIdGenerator() },
  spanProcessor,
);
```

The `AWSXRayIdGenerator` implements the same `IdGenerator` interface we use for our deterministic `spanId` approach:

```typescript
interface IdGenerator {
  generateTraceId(): string; // must return 32 lowercase hex chars
  generateSpanId(): string; // must return 16 lowercase hex chars
}
```

**AWS uses this in production to embed structured data (a timestamp) into trace IDs — we use the same mechanism to embed deterministic operation-derived data into span IDs.**

---

## Lambda's Built-in X-Ray Tracing

When X-Ray active tracing is enabled on a Lambda function, the Lambda runtime automatically:

1. Creates an X-Ray segment for each invocation
2. Injects the `X-Amzn-Trace-Id` header into the Lambda context
3. Exports the segment to X-Ray after the invocation completes

When the ADOT OTel SDK is also configured (with `AWSXRayPropagator`), it reads the `X-Amzn-Trace-Id` header from the Lambda context and uses it as the parent context for any OTel spans created in user code.

---

## Relevance to the AWS Durable Execution SDK

| X-Ray / ADOT concept                                            | Relevance to our SDK                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `AWSXRayIdGenerator` — custom `IdGenerator` in production       | Validates the `IdGenerator` approach for our deterministic `spanId` solution     |
| Timestamp embedded in `traceId`                                 | Same pattern: embed structured data (operationId hash) in `spanId`               |
| Lambda X-Ray segment = Layer 1 tracing                          | Already exists; our plugin is Layer 2                                            |
| `AWSXRayPropagator` reads `X-Amzn-Trace-Id` from Lambda context | OTel plugin can read this to nest step spans under the Lambda invocation segment |

The most important takeaway: **AWS itself uses a custom `IdGenerator` in production** to embed structured data into trace IDs. This is the same mechanism we use for deterministic `spanId`s derived from `operationId`. The pattern is not experimental — it is the official AWS-recommended way to use OTel with X-Ray.

---

## References

- [ADOT JavaScript SDK + X-Ray setup guide](https://aws-otel.github.io/docs/getting-started/js-sdk/trace-manual-instr)
- [`@opentelemetry/id-generator-aws-xray` on npm](https://www.npmjs.com/package/@opentelemetry/id-generator-aws-xray)
- [AWS X-Ray trace ID format](https://docs.aws.amazon.com/xray/latest/devguide/xray-api-sendingdata.html#xray-api-traceids)
