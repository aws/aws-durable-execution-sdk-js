# @aws/durable-execution-sdk-js-lite-otel

An OpenTelemetry tracing plugin for
[`@aws/durable-execution-sdk-js-lite`](../aws-durable-execution-sdk-js-lite/README.md).
It sends the spans of each durable execution to any OpenTelemetry `SpanExporter`. An
execution that `ctx.invoke` started joins the caller's trace.

To change this package, read [Contributing](#contributing) first.

## Status

This package is an alpha. It is private and not published to npm. Its API can change.

## What it does

A durable execution runs in several Lambda invocations. The plugin builds one trace for
the whole execution. This is the execution view: one span per durable operation, under one
workflow span.

| Span | Name | Parent |
|---|---|---|
| Workflow | the function name from the ARN, else `Workflow` | none (root); a link to the trace header's Parent |
| Operation | the operation's name, else its type, for example `WAIT` | the enclosing child context, else the workflow span |
| Attempt | `<name> attempt <n>`, one per step attempt and per `waitForCondition` check | the step's operation span |
| Invocation | `Invocation` | the workflow span |

The plugin creates no Tracer and no TracerProvider. It builds finished spans as plain
objects with the fields of `ReadableSpan` from `@opentelemetry/sdk-trace-base` 2.x. Then it
passes them to `exporter.export`, during the invocation and at its end (see
[When spans are sent](#when-spans-are-sent)).

So the plugin's spans bypass every span processor and every TracerProvider setting:

1. A span processor that you register, for example one that adds or redacts attributes,
   never sees the durable spans. Spans that your own code creates still pass through it.
2. The span limits of a TracerProvider, for example `spanLimits.attributeCountLimit`, do
   not apply.
3. The sampler of a TracerProvider does not decide for the durable spans. The plugin
   decides itself (see [Sampling](#sampling)).
4. To change the durable spans before they leave the process, wrap the exporter. For
   example, pass an object whose `export(spans, resultCallback)` edits `spans` and then
   calls the real exporter.

## Requirements

- Node.js 22.12 or later. The package has no dependencies.
- A `SpanExporter`, for example `OTLPTraceExporter` from
  `@opentelemetry/exporter-trace-otlp-http` or `@opentelemetry/exporter-trace-otlp-proto`.

## Usage

```js
import { withDurableExecution } from "@aws/durable-execution-sdk-js-lite";
import { createOtelPlugin } from "@aws/durable-execution-sdk-js-lite-otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

// Created once per Lambda sandbox. Every invocation shares it.
const exporter = new OTLPTraceExporter({
  url: process.env.OTLP_TRACES_URL,
  headers: { Authorization: `Bearer ${process.env.OTLP_TOKEN}` },
});

export const handler = withDurableExecution(workflow, {
  plugins: [createOtelPlugin({ exporter, serviceName: "orders" })],
});
```

Never write a token into the code. Read it from an environment variable, as above. Or read
it from AWS Secrets Manager once, outside the handler, and create the exporter with it.

`OTLPTraceExporter` also reads the standard `OTEL_EXPORTER_OTLP_*` variables, for example
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`. The plugin itself
reads the variables in [Environment variables](#environment-variables).

By default, the plugin traces every execution. Every traced execution exports one span per
operation, one per step attempt, one per invocation and one for the workflow. A backend
that bills per span or per byte bills all of them. To trace fewer executions, set
`sampleRate` or `OTEL_TRACES_SAMPLER` (see [Sampling](#sampling)).

### Sending to CloudWatch and X-Ray

The plugin has no built-in exporter. A small exporter in your code sends the spans to the
X-Ray OTLP endpoint, `https://xray.<region>.amazonaws.com/v1/traces`. The endpoint needs
two things:

1. Transaction Search, enabled once per account and region. Without it, the endpoint
   returns HTTP 400: "The OTLP API is supported with CloudWatch Logs as a Trace Segment
   Destination". To enable it, follow
   [Enable transaction search](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Enable-TransactionSearch.html).
   `aws xray get-trace-segment-destination` then returns `CloudWatchLogs` and `ACTIVE`.
   Transaction Search changes the destination of all X-Ray spans of the account and region,
   and CloudWatch Logs pricing applies to them.
2. Requests signed with SigV4 for the service `xray`. The function's role needs
   `xray:PutTraceSegments`. The managed policies `AWSXRayDaemonWriteAccess` and
   `AWSXrayWriteOnlyAccess` grant it.

This exporter uses the AWS SDK's signer and the OTLP serializer of OpenTelemetry:

```js
// npm install @aws-crypto/sha256-js @aws-sdk/credential-provider-env
//   @opentelemetry/otlp-transformer @smithy/signature-v4
import { Sha256 } from "@aws-crypto/sha256-js";
import { fromEnv } from "@aws-sdk/credential-provider-env";
import { ProtobufTraceSerializer } from "@opentelemetry/otlp-transformer";
import { SignatureV4 } from "@smithy/signature-v4";

// Sends spans to the X-Ray OTLP endpoint, signed with the function's role.
export function xrayExporter({ region = process.env.AWS_REGION, timeoutMs = 3000 } = {}) {
  const url = new URL(`https://xray.${region}.amazonaws.com/v1/traces`);
  const signer = new SignatureV4({ service: "xray", region, credentials: fromEnv(), sha256: Sha256 });
  return {
    export(spans, resultCallback) {
      const body = ProtobufTraceSerializer.serializeRequest(spans);
      signer
        .sign({
          method: "POST",
          protocol: "https:",
          hostname: url.hostname,
          path: url.pathname,
          headers: { host: url.hostname, "content-type": "application/x-protobuf" },
          body,
        })
        .then((signed) =>
          fetch(url, { method: "POST", headers: signed.headers, body, signal: AbortSignal.timeout(timeoutMs) }),
        )
        .then(
          (res) =>
            resultCallback(
              res.ok ? { code: 0 } : { code: 1, error: new Error(`X-Ray returned HTTP ${res.status}`) },
            ),
          (error) => resultCallback({ code: 1, error }),
        );
    },
  };
}
```

```js
createOtelPlugin({ exporter: xrayExporter() });
```

1. `fromEnv()` reads the credentials that Lambda puts in the function's environment.
2. A failed request calls `resultCallback` with code 1. The plugin then logs one line,
   and the workflow is unchanged.
3. The spans are stored in the log group `aws/spans`. Transaction Search finds them by
   trace id, by attribute and by service.
4. The trace id is the X-Ray Root of the invocation (see [Trace id](#trace-id)). So with
   Active tracing, the durable spans and the Lambda segments of each invocation are in one
   trace.
5. The X-Ray trace summaries and the trace map show only indexed spans. The share of
   indexed spans is the indexing rule of Transaction Search. By default it is 1%.

Measured on Lambda in us-west-2 with Active tracing: a workflow with a step, a wait and a
second step ran in two invocations. All 8 durable spans and the user span inside the
first step reached `aws/spans`, in the same trace as the Lambda spans of both invocations. A retried step
gave its two attempt spans, the first one `ERROR`. `StartTraceRetrieval` and
`ListRetrievedTraces` with `--trace-format OTEL` returned the whole trace.

## Configuration

`createOtelPlugin(config)` returns a plugin factory. `config` has these keys:

- `exporter` (required): any OpenTelemetry `SpanExporter`. The plugin calls
  `export(spans, resultCallback)` once per batch. It calls `export` again only after the
  previous export settled. It calls `forceFlush()` after a successful export, if the
  exporter has it. It never calls `shutdown()`.
- `resource` (optional): the OpenTelemetry Resource of every span, for example from
  `resourceFromAttributes` of `@opentelemetry/resources` 2.x. The plugin uses it as is.
  The environment variables do not change it.
- `serviceName` (optional): `service.name` of the default resource. Ignored when
  `resource` is set.
- `sampleRate` (optional): the fraction of executions to trace, from 0 to 1. Default:
  the ratio of `OTEL_TRACES_SAMPLER`, else 1.
- `parentBased` (optional): `true` lets the `Sampled` field of the Lambda trace header
  decide. Default: `true` for a `parentbased_*` value of `OTEL_TRACES_SAMPLER`, else
  `false`. See [Sampling](#sampling).
- `exportTimeoutMs` (default 3000): each export waits at most this many milliseconds.
  `onInvocationEnd` also waits at most this long for all exports. It also never waits
  past 500 ms before the Lambda timeout. See
  [Sizing the Lambda timeout](#sizing-the-lambda-timeout).
- `flushIntervalMs` (default 5000): finished operation and attempt spans are sent at most
  this many milliseconds after they end, during the invocation. `0` sends every span at
  the end of the invocation.
- `otelApi` (optional): your `@opentelemetry/api` module namespace (`import * as api`),
  or an object `{ context, trace }`. The plugin calls only `context.active()`,
  `context.with(context, fn)` and `trace.setSpanContext(context, spanContext)`. It does
  not check the object. Without `otelApi`, the plugin finds the context manager of
  `@opentelemetry/api` 1.x itself. See [Context propagation](#context-propagation).

The default resource has these attributes. An attribute without a value is omitted.

- `service.name`: `serviceName`, else `OTEL_SERVICE_NAME`, else `service.name` of
  `OTEL_RESOURCE_ATTRIBUTES`, else `AWS_LAMBDA_FUNCTION_NAME`, else `durable-function`.
- `cloud.provider`: `aws`.
- `cloud.region`: `AWS_REGION`.
- `faas.name`: `AWS_LAMBDA_FUNCTION_NAME`.
- every attribute of `OTEL_RESOURCE_ATTRIBUTES`. It replaces a default of the same name.

The OTLP serializer of `@opentelemetry/otlp-transformer` reads only `attributes` and
`schemaUrl` from a resource. The default resource also has the other members of the
Resource interface. To add attributes, set `OTEL_RESOURCE_ATTRIBUTES` or pass your own
Resource.

### Environment variables

The plugin reads these standard OpenTelemetry variables once, when `createOtelPlugin`
runs. A key in `config` wins over a variable. A variable wins over the default.

| Variable | Effect |
|---|---|
| `OTEL_SDK_DISABLED` | `true`, in any case, turns tracing off: the factory returns no plugin, so the SDK calls no hook. Every other value changes nothing. |
| `OTEL_SERVICE_NAME` | `service.name` of the default resource. |
| `OTEL_RESOURCE_ATTRIBUTES` | Attributes of the default resource, as `key1=value1,key2=value2` with percent-encoding, for example `team=a%2Cb` for the value `a,b`. |
| `OTEL_TRACES_SAMPLER` | `always_on`, `always_off`, `traceidratio`, `parentbased_always_on`, `parentbased_always_off` or `parentbased_traceidratio`, in any case. See [Sampling](#sampling). |
| `OTEL_TRACES_SAMPLER_ARG` | The ratio of the two `*traceidratio` samplers, from 0 to 1. Default 1. |

An invalid value is ignored, and the plugin logs one line with `console.warn`:

1. An `OTEL_RESOURCE_ATTRIBUTES` with one invalid pair is ignored as a whole, as the
   OpenTelemetry specification requires. Examples: `a=1,b` and `a=%zz`.
2. Another sampler, for example `xray` or `jaeger_remote`, is ignored. The default
   applies.
3. An `OTEL_TRACES_SAMPLER_ARG` that is not a number from 0 to 1 is replaced by 1.

The plugin does not read these variables:

- `OTEL_EXPORTER_OTLP_*`: the exporter reads them. `OTLPTraceExporter` does.
- `OTEL_TRACES_EXPORTER`: you pass the exporter as `exporter`.
- `OTEL_BSP_*`: the plugin has no BatchSpanProcessor. `flushIntervalMs` and
  `exportTimeoutMs` set its schedule. Their meaning differs from the BSP variables. For
  example, `flushIntervalMs` 0 sends only at the end of the invocation.
- `OTEL_PROPAGATORS`: the plugin uses only the Lambda trace header.
- `OTEL_SPAN_*_LIMIT` and `OTEL_ATTRIBUTE_*_LIMIT`: the plugin's spans have a fixed set of
  attributes, events and links.

### When spans are sent

1. A finished operation span or attempt span goes into a buffer of the invocation. A
   timer sends the buffer at most `flushIntervalMs` after the previous export. So such a
   span is sent during the invocation, at most `flushIntervalMs` after it ends.
2. The invocation span and the workflow span are sent at the end of the invocation.
   `onInvocationEnd` sends them with the rest of the buffer.
3. So a backend can show a child before its parent. This happens within one invocation,
   and across invocations. The trace is complete when the execution ends.
4. A crash or a Lambda timeout skips `onInvocationEnd`. Then the spans that finished in
   the last interval are lost, and the invocation span is lost. The spans of the earlier
   intervals were already sent.
5. Tail sampling in a collector decides per batch of spans. It can drop a parent that
   arrives later than its children. So prefer `sampleRate`.

The lite SDK recommends sending only in `onInvocationEnd`, because it awaits only that
hook. The plugin sends earlier, and still follows the reason for that rule:

1. `onInvocationEnd` awaits every export that started earlier. So no export runs when the
   handler returns.
2. The final export starts after the earlier exports. So `onInvocationEnd` waits at most
   `exportTimeoutMs` in total, and never past 500 ms before the Lambda timeout. When
   earlier exports still run at that deadline, the final batch is not sent, and the plugin
   logs one line with `console.warn`.
3. The timer is unref'd, so it never keeps a process alive. `onInvocationEnd` clears it.
   A span that ends after `onInvocationEnd` started is dropped.

### Sizing the Lambda timeout

The handler returns its output only after `onInvocationEnd` settles. So the final export
adds time to every invocation:

1. A fast backend takes a few milliseconds. A slow or unreachable backend takes up to
   `exportTimeoutMs`, 3 seconds by default.
2. An invocation that reaches the Lambda timeout fails. Lambda ends it and drops its
   output. The function's `Errors` metric counts it, and its log shows "Task timed out".
   Lambda then invokes again. The replay returns the same output, so the workflow result
   is unchanged. But the invocation error can trigger alarms, and the execution takes
   longer and costs one more invocation.
3. So the plugin bounds its wait by the time left. It reads
   `lambdaContext.getRemainingTimeInMillis()` when the invocation ends. The final export
   gets at most that time minus 500 ms. With less than 500 ms left, the plugin sends
   nothing and logs one line. The spans of that batch are lost. The output is not.

So telemetry never makes an invocation time out. A tight timeout can still lose spans.
To keep traces complete:

1. Set the Lambda timeout above the longest expected invocation plus `exportTimeoutMs`
   plus 500 ms.
2. If invocations run close to the timeout, lower `exportTimeoutMs`, for example to 1000.
3. Keep each invocation well under the timeout. For example, split a long step into
   shorter steps. A durable function resumes in a new invocation, so shorter invocations
   cost nothing in correctness.

### Sampling

The plugin decides once per invocation. For an execution that is not traced, the factory
returns `undefined`. So the SDK calls no plugin hook. Two inputs can decide: a ratio, and
the `Sampled` field of the Lambda trace header.

| `OTEL_TRACES_SAMPLER` | Ratio | Uses `Sampled` |
|---|---|---|
| unset (default) | 1 | no |
| `always_on` | 1 | no |
| `always_off` | 0 | no |
| `traceidratio` | `OTEL_TRACES_SAMPLER_ARG` | no |
| `parentbased_always_on` | 1 | yes |
| `parentbased_always_off` | 0 | yes |
| `parentbased_traceidratio` | `OTEL_TRACES_SAMPLER_ARG` | yes |

`sampleRate` replaces the ratio. `parentBased` replaces the last column. Each key replaces
only its own part. For example, `parentbased_traceidratio` with `sampleRate: 1` uses
`Sampled`, and traces every execution without a `Sampled` decision.

The default traces every execution. The default of the OpenTelemetry specification is
`parentbased_always_on`. The plugin's default differs, because in PassThrough tracing the
parent-based default would trace almost no execution (see below).

#### The ratio

The ratio decides from the trace id (see [Trace id](#trace-id)). The trace id is the same
in every invocation of one execution. So every invocation makes the same decision, and a
trace is complete or absent. An execution that `ctx.invoke` started has the caller's trace
id. So with the same ratio, it makes the caller's decision.

1. The plugin reads the last 8 hex digits of the trace id as a number.
2. It divides the number by 2^32.
3. The execution is traced if the result is below the ratio.

#### The Sampled field

With `parentBased`, `Sampled=1` traces the invocation and `Sampled=0` does not. Without a
`Sampled` decision, for example with `Sampled=?` or without a header, the ratio decides.

Lambda gives every invocation of one execution the same `Sampled` value. So the decision
is the same in every invocation, as with the ratio. Measured on Lambda in us-west-2, with
executions that ran in two invocations each:

1. PassThrough tracing, 27 executions started with `aws lambda invoke`: every invocation
   had `Sampled=0`. With `parentbased_always_on`, the plugin traced none of 6 such
   executions. Without `OTEL_TRACES_SAMPLER`, it traced all of 6.
2. Active tracing, 27 executions: each execution had one `Sampled` value in both
   invocations. Lambda's X-Ray sampling set it: 26 executions had `Sampled=1`, one had
   `Sampled=0`. With `parentbased_always_on`, the plugin traced all 12 executions of one
   run, which all had `Sampled=1`.

So use a `parentbased_*` sampler when Lambda's X-Ray sampling, or a traced upstream caller,
should decide. Example: Active tracing, with the durable spans sent to X-Ray (see
[Sending to CloudWatch and X-Ray](#sending-to-cloudwatch-and-x-ray)). Then the durable spans
exist exactly for the traces that have Lambda segments. In PassThrough tracing without a
traced upstream caller, do not use a `parentbased_*` sampler.

An execution that `ctx.invoke` started receives `Sampled=1` from a traced caller (see
[Propagation through ctx.invoke](#propagation-through-ctxinvoke)). So with `parentBased`,
it is traced whenever its caller is.

## Span model

### Trace id

1. Lambda gives every invocation a trace header in the X-Ray format, for example
   `Root=1-6a0b1c2d-0123456789abcdef01234567;Parent=89abcdef01234567;Sampled=1`. The
   invocation reads it from `lambdaContext.xRayTraceId` and from
   `process.env._X_AMZN_TRACE_ID`.
2. Lambda Managed Instances run several invocations in one process at the same time. So
   `_X_AMZN_TRACE_ID` can belong to another invocation. So the plugin reads
   `lambdaContext.xRayTraceId`, and reads the environment variable only when
   `lambdaContext.xRayTraceId` is absent.
3. If the header has a valid `Root=1-<8 hex>-<24 hex>`, the trace id is those 32 hex
   digits. Else the trace id is the SHA-256 of the ARN (see [Ids](#ids)). On Lambda,
   every invocation has a header. So the ARN hash is used only outside Lambda, for
   example in tests.
4. The service gives every invocation of one execution the same Root. So every
   invocation of the execution computes the same trace id.

Because the trace id is the X-Ray Root:

1. The execution's spans are in the same trace as the Lambda X-Ray segments of its
   invocations.
2. If the upstream caller was traced, for example API Gateway with X-Ray, Lambda keeps its
   Root. So the execution's spans are in the upstream caller's trace.
3. So two executions that one upstream request started share one trace. Each has its own
   workflow span as a root.
4. An execution that `ctx.invoke` started gets the caller's Root (see
   [Propagation through ctx.invoke](#propagation-through-ctxinvoke)).

### Ids

Every invocation of one execution computes the same id for the same span. So a span that
one invocation emits can be the parent of a span that a later invocation emits. Each span
id is a prefix of the SHA-256 hex digest of a string. `arn` is the `DurableExecutionArn`.
`operationId` is the record's `Id`.

| Id | Hashed string | Length |
|---|---|---|
| trace id | the 32 hex digits of the trace header's `Root`; without a valid `Root`, `arn` | 32 |
| workflow span id | `workflow:` + `arn` | 16 |
| operation span id | `arn` + `:` + `operationId` | 16 |
| attempt span id | `arn` + `:` + `operationId` + `:attempt:` + attempt number | 16 |
| invocation span id | `arn` + `:invocation:` + request id | 16 |

Without a request id, the invocation span id is random.

### Which invocation emits what

1. An operation span is built in the invocation in which its record became terminal. The
   plugin builds it in `onOperationChange`, when a checkpoint response returns the
   terminal record. It builds the remaining ones from the final records in
   `onInvocationEnd`. With `flushIntervalMs` 0, it builds all of them there. Terminal
   statuses are `SUCCEEDED`, `FAILED`, `TIMED_OUT`, `STOPPED` and
   `CANCELLED`.
2. A record that was terminal when the invocation started was emitted by an earlier
   invocation. So it is skipped.
3. The exception to rule 2 is a WAIT, CALLBACK or CHAINED_INVOKE record in
   `updatedOperationIds`. The service ends these records. It can end one between two
   invocations, for example when a wait's time passes. Then no earlier invocation saw it
   end. So the next invocation emits it.
4. Only the SDK ends a STEP or CONTEXT record. So an earlier invocation always saw it end.
   After an invocation times out, the service lists every record that invocation changed
   in `updatedOperationIds`. The interval flush already sent most of those spans. So a
   STEP or CONTEXT record in `updatedOperationIds` is still skipped. If an invocation
   crashes, its spans that finished in the last interval are lost.
4. The span's start and end are the record's `StartTimestamp` and `EndTimestamp`. Without
   `EndTimestamp`, the span ends at the end of the invocation. A step's or a child
   context's span also covers the attempts and the context runs of this invocation:
   1. A step's START and a child context's START are not awaited. They can reach the
      service with a later update, for example with SUCCEED. Then `StartTimestamp` is
      after `fn` ran.
   2. The record's timestamps come from the service's clock. Attempt spans come from the
      Lambda clock.
   3. So the span starts at the earlier of `StartTimestamp` and the first local start of
      an attempt or a context run in this invocation. It ends at the later of
      `EndTimestamp` and the last local end.
5. An attempt span is built when the attempt's `fn` settles. Its times are measured in the
   Lambda function.
6. The invocation span starts when the factory runs. It ends when `onInvocationEnd` runs.
7. The workflow span is emitted only by the invocation whose status is `SUCCEEDED` or
   `FAILED`. It starts at the `EXECUTION` record's `StartTimestamp`.

### Attributes

| Attribute | Spans |
|---|---|
| `durable.execution.arn` | all |
| `durable.operation.id`, `durable.operation.type`, `durable.operation.name`, `durable.operation.subtype` | operation, attempt |
| `durable.operation.status` | operation |
| `durable.attempt.number` | attempt; operation of a `STEP` (`StepDetails.Attempt`) |
| `durable.execution.status` | workflow |
| `durable.trace.header_parent`: the `Parent` of the trace header, if valid | workflow |
| `faas.invocation_id`, `durable.invocation.status`, `durable.invocation.first` | invocation |

### Status

The plugin uses the status mapping of `@aws/durable-execution-sdk-js-otel`:

- An operation span is `ERROR` for `FAILED`, `TIMED_OUT` and `STOPPED`, and for any
  record with an error. The message is the record's `ErrorMessage`, else the status.
  It is `OK` for `SUCCEEDED`. A `CANCELLED` operation without an error stays `UNSET`:
  it did not fail, the SDK abandoned it.
- A failed operation, a failed attempt and a failed workflow also have one `exception`
  event with `exception.type` and `exception.message`.
- An attempt span is `ERROR` when `fn` threw or rejected. Else it is `OK`.
- An invocation span is `ERROR` for `FAILED` and `OK` for `SUCCEEDED` and `PENDING`. A
  `RETRYING` invocation stays `UNSET`, because Lambda invokes again and the retry can
  succeed. `durable.invocation.status` holds the status in every case.
- The workflow span is `OK` for `SUCCEEDED` and `ERROR` for `FAILED`.

## Propagation through ctx.invoke

The lite SDK calls the plugin's `traceHeader` hook when `ctx.invoke` sends its START. The
hook returns this header:

```
Root=1-<first 8 hex of the trace id>-<last 24 hex>;Parent=<span id of the CHAINED_INVOKE operation>;Sampled=1
```

1. The SDK sends it as `ChainedInvokeOptions.XAmznTraceId`.
2. The service gives it to the invoked execution as its Lambda trace header, in every
   invocation. Lambda appends a `Lineage` field.
3. So the invoked execution's trace id is the caller's trace id. Both executions are in
   one trace.
4. `Sampled` is 1, because the plugin exists only in a traced execution. An untraced
   caller has no plugin, so it sends no header. The service then gives the invoked
   execution the caller's own header. Its Root gives the caller's trace id, so the
   invoked execution is untraced too.

The invoked execution's workflow span has a link to the header's `Parent`. The link has
the attribute `durable.link` = `invoker`. The workflow span has no parent. The reasons:

1. A parent must be a span in the trace. Else the backend shows a broken tree.
2. In PassThrough tracing, Lambda keeps the `Parent` that the caller sent. So `Parent` is
   the caller's CHAINED_INVOKE span. That span exists.
3. In Active tracing, Lambda replaces `Parent` in every invocation with a span of its own.
   This plugin never exports that span.
4. A top-level execution has a `Parent` too: a Lambda span or a span of the upstream
   caller. This plugin never exports these spans either.
5. A link can point to a span that does not exist.
6. So the workflow span stays a root span, and links to `Parent`.

The final invocation emits the workflow span. So the link uses the `Parent` of that
invocation's header. So a trace with one `ctx.invoke` has two root spans: the caller's
workflow span and the invoked execution's workflow span.

## Context propagation

The plugin makes a durable span the active span while user code runs:

- the attempt span, while a step's `fn` runs;
- the operation span, while a child context's `fn` runs;
- the invocation span, while the workflow function runs.

Then spans that your code or an auto-instrumentation creates inside a step are children of
the attempt span. This needs a context manager that you register with
`@opentelemetry/api`. A context manager follows the active span across `await`. Register
one once, for example `AsyncLocalStorageContextManager` from
`@opentelemetry/context-async-hooks`:

```js
import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
```

The `register()` of a `NodeSDK` or a `NodeTracerProvider` registers one too.

The plugin does not import `@opentelemetry/api`. It reaches the API in one of two ways.

### With otelApi

Pass the API to the plugin. Use this way when your code already imports the API.

```js
import * as api from "@opentelemetry/api";

createOtelPlugin({ exporter, otelApi: api });
```

1. The plugin calls `api.trace.setSpanContext(api.context.active(), spanContext)`. The
   result is a context that holds a non-recording span of the durable span's ids.
2. It runs user code with `api.context.with(thatContext, fn)`.
3. These are public functions of the API. So this way works with every API version that
   keeps them, also a future major version.

### Without otelApi

The plugin finds the context manager of `@opentelemetry/api` 1.x itself:

1. Several copies of the API can be loaded in one process. So the API keeps one shared
   registry on `globalThis`, under `Symbol.for("opentelemetry.js.api.1")`.
2. `context.setGlobalContextManager` stores the context manager in that registry.
3. The active span is the value of the context key
   `Symbol.for("OpenTelemetry Context Key SPAN")`.
4. So the plugin reads the context manager from the registry. It calls the manager's
   `with` with a context that holds a non-recording span of the durable span's ids.
5. So `trace.getActiveSpan()` in user code returns that span.

The plugin looks up the registry when it first runs user code. It keeps a registry that it
found. It looks again on every run while it finds none. So a context manager that you
register after you create the plugin, for example with `NodeSDK.start()`, is used.

Another major version of the API stores its registry under another key, for example
`Symbol.for("opentelemetry.js.api.2")`. The plugin does not know that registry's layout:

1. So it does not use that registry. User code runs, and user spans do not nest under
   the durable spans.
2. It logs one line with `console.warn`, once per process for each such major version.
   The line names the registry's version and recommends `otelApi`.
3. The durable spans are unaffected.

### Without a context manager

Without a registered context manager, user spans do not nest under the durable spans. The
plugin's own spans are still complete, because it sets every parent from the ids above. So
a runtime without `AsyncLocalStorage`, for example LLRT, still gets every durable span.

## Limitations

- A sandbox can crash or time out before `onInvocationEnd` runs. Then the spans of the
  last `flushIntervalMs` and the invocation span are lost.
- A failed export is not retried. The plugin logs one line with `console.warn`.
- The span of a step whose first attempt ran in an earlier invocation can start after
  that attempt's span. See
  [Known gap: operation start across invocations](#known-gap-operation-start-across-invocations).
- An invocation that ends less than 500 ms before its Lambda timeout sends no final
  export. Its last spans, its invocation span and, for the final invocation, its workflow
  span are lost. See [Sizing the Lambda timeout](#sizing-the-lambda-timeout).
- A FLAT map or parallel item has no record. So it has no span. Its operations are
  children of the map's span.
- An abandoned operation, for example an item that still ran when a map completed early,
  never becomes terminal. So it has no span.
- A child span is sent before its parent. Until the parent is sent, the backend shows a
  missing parent. See [When spans are sent](#when-spans-are-sent).
- Tail sampling in a collector decides per batch of spans. It can drop a parent that
  arrives in a later batch. Use `sampleRate` instead.
- The real service can list a wait, a callback or an invoke in `updatedOperationIds` after
  an earlier invocation already emitted it. That happens after an invocation timeout. The
  span is then sent twice with the same span id.
- The plugin has no built-in X-Ray exporter. Use the exporter in
  [Sending to CloudWatch and X-Ray](#sending-to-cloudwatch-and-x-ray). The durable spans
  share the trace id of the Lambda X-Ray segments, but have no parent link to them. The
  workflow span is a root span next to the Lambda segments.
- The durable spans bypass span processors and TracerProvider settings (see
  [What it does](#what-it-does)).
- In Active tracing, the invoked execution's workflow span links to a span that Lambda
  generated, not to the caller's CHAINED_INVOKE span. Lambda replaces `Parent` in every
  invocation. Both executions still share one trace id.
- The workflow span of a top-level execution links to a Lambda or upstream span that
  this plugin does not export.
- Log lines do not carry the trace id or span id.
- Without `otelApi`, nesting depends on the internal registry layout of
  `@opentelemetry/api` major version 1 (see [Context propagation](#context-propagation)).
  With only another major version loaded, user spans do not nest under the durable spans.
  The plugin logs one warning. The durable spans are unaffected. Pass `otelApi` to avoid
  this.
- The plugin does not check `otelApi`. If the object lacks one of the three functions,
  the plugin throws a `TypeError` when it runs user code.

## Known gap: operation start across invocations

An operation span can start after its first attempt span. This happens for a step whose
first attempt ran in an earlier invocation, for example before a retry delay.

### Cause

1. The checkpoint API has no client timestamp. `OperationUpdate` carries no time.
2. So the service sets a record's `StartTimestamp` and `EndTimestamp` itself. It uses the
   time when it records the checkpoint request.
3. The SDK does not await START of an at-least-once step or of a child context. So START
   often travels in the same request as the attempt's SUCCEED or RETRY. The service then
   gives START that request's time, which is after the attempt ran.
4. Within one invocation, the plugin corrects this. It knows the local start and end of
   each attempt, and it extends the operation span to cover them (see
   [Which invocation emits what](#which-invocation-emits-what)).
5. The plugin keeps no state between invocations. So for a step that ends in a later
   invocation, it has no local start of the earlier attempts. That operation span starts
   at the record's `StartTimestamp`.

Example, measured on Lambda: attempt 1 ran at 40.084 s and failed in 1 ms. START and RETRY
travelled in one request, and the service recorded both at 40.495 s. Attempt 2 ran in the
next invocation. The step's span starts at 40.495 s, 411 ms after attempt 1.

### Impact

Nothing in OpenTelemetry fails. OpenTelemetry does not require a child to lie within its
parent's time. Exporters, collectors and backends accept the spans, and parent links use
span ids, not times. The impact is on the accuracy of the data:

- The operation span's duration is too short by up to the gap. Latency charts, span
  metrics and alerts that use it inherit the error.
- Backends that compute a span's self time or a critical path from its children can show
  wrong or negative values for that span.
- The trace view shows the attempt before its operation.
- Some backends adjust a child that starts before its parent, assuming clock skew between
  hosts. Such an adjustment can move the attempt span away from its real time.

The attempt spans themselves are accurate. They are measured in the Lambda function. For
the real duration of each attempt, use the attempt spans.

### What would close the gap

The checkpoint API would accept a client timestamp on each update, and return it on the
record, for example the local start and end of each attempt. The plugin would then read
it from the record. The SDK alone cannot close the gap without awaiting every START, which
adds one request round trip to every step.

## Differences from @aws/durable-execution-sdk-js-otel

- This plugin has only the execution view. The full plugin also has an invocation view.
- This plugin builds finished spans and calls the exporter directly. The full plugin uses
  a Tracer, a TracerProvider and a deterministic IdGenerator.
- This plugin takes the trace id from the trace header's Root, else from the ARN. It
  never uses the header's `Parent` as a parent. It links the workflow span to it. It
  reads `Sampled` only with a parent-based sampler, and its default ignores `Sampled`.
  The full plugin can also join a W3C parent.
- This plugin does not use `AsyncLocalStorage`. The full plugin does.
- This plugin has no dependencies. The full plugin has peer dependencies, among them
  `@opentelemetry/api`.
- This plugin propagates to chained invokes with the lite SDK's `traceHeader` hook. It has
  no log correlation, no context extractors and no loading from a Lambda layer.
- This plugin uses the same attribute names and the same status mapping (see
  [Status](#status)).
- This plugin names the workflow span after the function, from the ARN. The full plugin
  names it `Workflow`, unless you configure another name. So a query or dashboard that
  selects spans named `Workflow` does not find this plugin's workflow span. Select by
  `durable.execution.status`, which only the workflow span has.

## Contributing

This section is for people and AI agents who change this package. The rules of the lite
SDK's [Contributing](../aws-durable-execution-sdk-js-lite/README.md#contributing) section
apply, and so do the repository's [rules for every change](https://github.com/aws/aws-durable-execution-sdk-js/blob/main/CONTRIBUTING.md#rules-for-every-change). The rules below
add to them or replace them for this package:

1. `package.json` has no `dependencies`, no `peerDependencies`, no `devDependencies` and
   no `optionalDependencies`.
2. `src` imports only relative paths and `node:` built-ins. It never imports the lite SDK
   or `@opentelemetry/api`. `src/index.d.ts` defines the OpenTelemetry types it needs, with
   the shapes of the API's types. It imports the lite SDK's types by a relative path,
   because the lite SDK is not linked into the workspace `node_modules`.
3. `src` does not import `node:async_hooks`. Tests may, to register a context manager.
4. No per-invocation state at module level. Shared state lives in the closure of
   `createOtelPlugin`. Per-invocation state lives in the closure of one factory call.
5. A telemetry failure must never fail the workflow. So every export catches and logs its
   failure, and `onInvocationEnd` waits at most `exportTimeoutMs` in total. It also ends
   at least 500 ms before the Lambda timeout, because an invocation that reaches the
   timeout fails. This is the one safeguard that the package adds. Other misuse is
   documented, not checked.
6. A callback that arrives after `onInvocationEnd` started changes nothing and is never
   exported. Example: an attempt whose `fn` settles later. The lite SDK can deliver it,
   and it calls no `onOperationChange` after the outcome is decided (see
   [A plugin ignores work that settles after onInvocationEnd](../aws-durable-execution-sdk-js-lite/README.md#a-plugin-ignores-work-that-settles-after-oninvocationend)).
   The `ended` flag in `src/index.js` holds this rule. A test in `test/hooks.test.js`
   fails without it. Another test there checks that two plugin objects of concurrent
   invocations never mix spans.
7. Tests use `runDurable` from the lite testing package, through the lite SDK's
   `test/helpers/run-durable.js`, by a relative path.
8. Before a commit, run `npm test` in this folder and `npx biome check
   packages/aws-durable-execution-sdk-js-lite-otel` from the repository root. Both must
   pass.
9. Commit titles use the scope `sdk-lite-otel`, for example
   `feat(sdk-lite-otel): add execution-view tracing plugin`.

### Files

```
src/index.js     createOtelPlugin: the factory and the hooks
src/env.js       the OTEL_* environment variables
src/ids.js       deterministic ids and the sampling decision
src/spans.js     span objects, time conversion, the default resource
src/export.js    the export with a timeout
src/otel-context.js  the active span, through otelApi or the registry of @opentelemetry/api 1.x
src/version.js   the instrumentation scope version
src/index.d.ts   the public types
```
