# AWS Powertools for Lambda and Durable Execution Observability

## What Powertools Tracer Is

AWS Powertools for Lambda (`@aws-lambda-powertools/tracer`) is a thin, opinionated wrapper around the AWS X-Ray SDK for Node.js.

**What it provides:** Auto-captures cold starts, service name, responses, and errors as X-Ray annotations. Patches AWS SDK clients for automatic X-Ray subsegments. Available for TypeScript/JavaScript, Python, Java, and .NET.

**What it explicitly does NOT support:**

> _"Tracer relies on AWS X-Ray SDK over OpenTelemetry Distro (ADOT) for optimal cold start (lower latency)."_

Powertools Tracer is X-Ray only. There is no OTel/W3C `traceparent` support, no `TracerProvider`, no OTLP export.

---

## Relevance to Durable Execution SDK

Customers using Powertools Tracer are X-Ray users. The durable execution SDK's existing approach — extracting `_X_AMZN_TRACE_ID` per invocation and using `AWSXRayPropagator` — already works correctly for them.

However, Powertools does not address the durable execution-specific observability challenges:

- No awareness of steps, waits, retries, or parallel operations
- No execution-level span continuity across multiple Lambda invocations
- No sampling based on execution ARN

These gaps are exactly what the `DurableInstrumentationPlugin` interface is designed to fill.

---

## Option: An Official OTel Plugin Under the Powertools Namespace

One option worth considering — subject to agreement between both teams — is shipping the official OTel adapter plugin as part of the Powertools ecosystem.

**Why this could make sense:**

- Powertools is already the go-to observability toolkit for Lambda
- It would give the plugin a well-known, trusted home with existing documentation infrastructure

**Why it might not make sense:**

- Powertools Tracer is explicitly X-Ray-only today — adding OTel support would be a significant direction change
- The plugin is general-purpose (not just OTel) — a Powertools home might imply OTel-only
- We have plans for languages (Go, Rust) not supported by Powertools
- Powertools team would need to own and maintain it

**The neutral alternative:** Ship it as `@aws/durable-execution-sdk-js-otel` — a first-party package from the durable execution team, separate from Powertools.
