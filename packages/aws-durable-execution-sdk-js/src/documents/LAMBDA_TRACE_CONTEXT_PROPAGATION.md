# Passing Parent Trace Context to AWS Lambda Invocations

## Overview

When a service invokes a Lambda function and wants the Lambda's spans to appear as children of the caller's trace, the caller must pass the trace context to the Lambda. This document lists all available mechanisms.

---

## Option 1 — `X-Amzn-Trace-Id` Header (X-Ray Format)

The Lambda runtime reads `Lambda-Runtime-Trace-Id` and sets `_X_AMZN_TRACE_ID` before each handler invocation.

```typescript
const traceId = process.env._X_AMZN_TRACE_ID;
```

- ✅ Automatic for all AWS-to-AWS calls when X-Ray is enabled
- ❌ X-Ray format only — not W3C `traceparent`

---

## Option 2 — `ClientContext.Custom` (Direct Invoke Only)

```typescript
const clientContext = Buffer.from(
  JSON.stringify({
    Custom: {
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    },
  }),
).toString("base64");

await lambdaClient.send(
  new InvokeCommand({
    FunctionName: "my-function:$LATEST",
    ClientContext: clientContext,
    Payload: JSON.stringify(event),
  }),
);
```

```typescript
const traceparent = context.clientContext?.custom?.traceparent;
```

- ✅ Works for any trace format
- ✅ Separate from the business payload
- ❌ Direct Lambda invoke only
- ❌ 3583-byte limit on `ClientContext`

---

## Option 3 — Event Payload (Universal)

Embed the trace context directly in the Lambda event payload as a dedicated field.

- ✅ Works for all trigger types
- ❌ Pollutes the business payload

---

## Option 4 — HTTP Headers via API Gateway / ALB

```typescript
const traceparent = event.headers?.["traceparent"];
```

- ✅ Standard W3C mechanism
- ❌ Only works for HTTP-triggered Lambdas

---

## Option 5 — SQS / SNS Message Attributes

```typescript
const traceparent = record.messageAttributes?.traceparent?.stringValue;
```

- ✅ Works for SQS, SNS triggers
- ❌ Producer must explicitly add the attribute

---

## Comparison

| Option                     | Trigger types      | Format     | Automatic                |
| -------------------------- | ------------------ | ---------- | ------------------------ |
| `X-Amzn-Trace-Id`          | All (AWS services) | X-Ray only | ✅ When X-Ray enabled    |
| `ClientContext.Custom`     | Direct invoke only | Any        | ❌ Manual                |
| Event payload field        | All                | Any        | ❌ Manual                |
| HTTP headers (API GW)      | HTTP triggers only | Any (W3C)  | ✅ With OTel HTTP client |
| SQS/SNS message attributes | Messaging triggers | Any        | ❌ Manual                |

---

## Implications for Durable Execution SDK Plugins

The instrumentation plugin receives the trace context in `onInvocationStart` and can extract it from whichever mechanism the developer used:

```typescript
onInvocationStart(info: InvocationInfo) {
  // X-Ray (automatic)
  const xrayCtx = process.env._X_AMZN_TRACE_ID;
  // clientContext (if caller passed it)
  const clientCtx = info.lambdaContext?.clientContext?.custom?.traceparent;
  // event payload (if caller embedded it)
  const payloadCtx = info.executionInput?._traceContext?.traceparent;
}
```

No SDK or backend changes are required for options 1, 3, and 4. The only backend fix needed is for option 2 (`clientContext`): the durable execution backend currently does not store or propagate `clientContext` across invocations.
