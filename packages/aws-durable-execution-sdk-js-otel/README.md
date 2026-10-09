# AWS Durable Execution SDK - OpenTelemetry Plugin

OpenTelemetry instrumentation for the AWS Durable Execution SDK. The package
provides two plugins that emit Workflow, Invocation, durable operation, and
operation-attempt spans.

The whole durable execution shares **one trace**, anchored at the execution
ancestor resolved at invocation start. The `Workflow` span and every per-invocation
`Invocation` span join that trace, so a single trace ID spans all invocations of
the execution.

They differ in where durable operation spans are parented:

| Plugin                 | Operation hierarchy                  | Cross-link                              |
| ---------------------- | ------------------------------------ | --------------------------------------- |
| `ExecutionOtelPlugin`  | `Workflow -> operation -> attempt`   | Operations and attempts link Invocation |
| `InvocationOtelPlugin` | `Invocation -> operation -> attempt` | Operations and attempts link Workflow   |

The plugins do not create or register an OpenTelemetry provider, exporter,
sampler, resource, propagator, context manager, or library instrumentation.
They use the global provider by default, or an application-owned provider
created through `tracerProviderFactory`.

## Installation

```bash
npm install @aws/durable-execution-sdk-js-otel \
            @aws/durable-execution-sdk-js \
            @opentelemetry/api \
            @opentelemetry/core \
            @opentelemetry/sdk-trace-node
```

The package requires Node.js 22 or later. Exporters, span processors,
propagators, resources, and library instrumentation are application or ADOT
responsibilities.

## Quick Start

When an SDK provider is registered globally, no plugin configuration is
required:

```typescript
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { ExecutionOtelPlugin } from "@aws/durable-execution-sdk-js-otel";

const plugin = new ExecutionOtelPlugin();

export const handler = withDurableExecution(
  async (event, context) => {
    return context.step("process", async () => process(event));
  },
  { plugins: [plugin] },
);
```

Use `InvocationOtelPlugin` instead when operations should appear under each
Lambda invocation rather than under the durable Workflow.

## Provider Setup

### Global Provider

Omitting `tracerProviderFactory` uses `trace.getTracerProvider()`. This is the
normal setup for the ADOT Lambda layer, OpenTelemetry zero-code
instrumentation, or an application that registers its own provider globally.

When using ADOT, activate its instrumentation wrapper:

```text
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-instrument
```

The OpenTelemetry JavaScript API does not provide a public way to retrieve or
replace a provider's configured ID generator. For a compatible SDK tracer, the
plugin therefore:

1. reads the tracer's runtime `_idGenerator` field;
2. replaces it with a guarded deterministic wrapper;
3. delegates all ID generation outside plugin span creation to the original
   generator.

This private-field integration is isolated behind runtime shape and assignment
checks. It does not change IDs for unrelated spans, including spans created
concurrently or with the same instrumentation scope.

If the plugin is constructed before the SDK provider is globally registered,
its initial tracer may be a proxy without `_idGenerator`. At each invocation
start, the plugin re-resolves the global provider until a compatible SDK tracer
is available. When installation still fails:

- plugin telemetry and log enrichment are disabled for that invocation;
- a warning is emitted;
- provider resolution is retried on the next invocation.

Providers or future SDK tracers that do not expose the compatible runtime field
cannot use this global-provider path. Use `tracerProviderFactory` to install the
generator through the supported provider constructor API.

### Application-Owned Provider

`tracerProviderFactory` receives a function that creates the plugin's
deterministic ID wrapper. The factory is called during plugin construction.

```typescript
import { InvocationOtelPlugin } from "@aws/durable-execution-sdk-js-otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";

const plugin = new InvocationOtelPlugin({
  tracerProviderFactory: (createIdGenerator) => {
    const provider = new NodeTracerProvider({
      idGenerator: createIdGenerator(),
      spanProcessors: [
        new SimpleSpanProcessor(
          new OTLPTraceExporter({
            url: "http://localhost:4318/v1/traces",
          }),
        ),
      ],
    });

    provider.register();
    return provider;
  },
});
```

`createIdGenerator()` delegates non-durable IDs to OpenTelemetry's standard
random generator. To preserve another generator, pass it as the fallback:

```typescript
idGenerator: createIdGenerator(applicationIdGenerator);
```

The deterministic override is active only for the synchronous `startSpan()`
call made by the plugin. All unrelated IDs use the fallback generator.

The application owns the returned provider and all associated configuration:

- exporters and span processors;
- sampling and resources;
- context management and propagation;
- HTTP, AWS SDK, Lambda, and other library instrumentation;
- global registration;
- shutdown.

The provider does not have to be the global provider for the plugin to obtain a
tracer from it. Register it globally when the application also needs its
context manager, propagator, or library instrumentation.

At the end of each enabled invocation, both plugins call `forceFlush()` when
the provider exposes it. They never call `shutdown()`.

## Dynamic Loading from a Lambda Layer

The SDK can load either plugin without importing it in function code. Package
this module and its OpenTelemetry peer dependencies in a Lambda layer under
`nodejs/node_modules`, then configure one entry point:

```text
DURABLE_EXECUTION_PLUGINS=@aws/durable-execution-sdk-js-otel/otel-execution
```

or:

```text
DURABLE_EXECUTION_PLUGINS=@aws/durable-execution-sdk-js-otel/otel-invocation
```

Do not package `@aws/durable-execution-sdk-js` in the layer. The provider entry
points use SDK types only, and the SDK peer dependency is optional so package
installation does not add a second copy. At runtime, the plugin is loaded and
driven by the SDK instance bundled with the function.

Dynamic providers construct plugins with default configuration, so they
require a compatible globally registered SDK provider. Use code-based
registration when `tracerProviderFactory` or other custom configuration is
needed.

## Choosing a Plugin

Configure exactly one durable OTel view: `ExecutionOtelPlugin` for a workflow
view, or `InvocationOtelPlugin` for an invocation view. Registering both (or
registering one view twice) raises `PluginLoadError` before invocation hooks
run. This applies to explicit `plugins`, `DURABLE_EXECUTION_PLUGINS`, and any
combination of the two. Other instrumentation plugins can run alongside the
selected view.

### `ExecutionOtelPlugin`

Use this plugin for a workflow-centered view. Operations and attempts are
children of the `Workflow` span. Each also links to the `Invocation` span that
observed it. The whole execution shares one trace.

```text
Execution trace

Execution ancestor
├── Workflow
│   └── Operation: fetch-data
│       └── Attempt 1
└── Invocation

Links:
Operation -> Invocation
Attempt   -> Invocation
```

The plugin makes Workflow the active span while durable handler code runs.
Completed operation spans use durable operation start/end timestamps and
deterministic span IDs. While an operation spans multiple invocations its
identity is carried as a non-recording context; nothing is exported until it
completes. The single recording operation span is then created and ended once,
in the invocation where the operation terminates, under a **deterministic span
ID on the execution trace**. Because there is one span per logical operation,
no cross-invocation link is needed to stitch it together — unlike
`InvocationOtelPlugin` below.

### `InvocationOtelPlugin`

Use this plugin for an invocation-centered view. Operations and attempts are
children of the current `Invocation` span. Each links to the `Workflow` span.
The whole execution shares one trace.

```text
Execution trace

Execution ancestor
├── Workflow
└── Invocation
    └── Operation: fetch-data
        └── Attempt 1

Links:
Operation -> Workflow
Attempt   -> Workflow
```

The plugin makes Invocation the active span while durable handler code runs.
Open operation spans are ended at the invocation boundary and retain
`durable.operation.status=STARTED`. When an operation completes in a later
invocation, the plugin emits a continuation span in that invocation.

Live invocation-view span boundaries and exception events use a wall-clock
origin captured with `Date.now()` at invocation start, advanced by monotonic
elapsed time. This matches the clock model of ordinary `tracer.startSpan()`
spans instead of using the process-wide `performance.timeOrigin`. Absolute
`HrTime` tuples keep epoch milliseconds distinct from relative performance time.
Each resumed invocation captures its own anchor. Supplied execution-start
Dates used to backdate Workflow and synthetic roots are preserved; execution-view
provided timestamps are retained without adding cross-clock boundary compensation.

The wall and monotonic reads are not atomic. Sampling delay, millisecond wall
precision, later wall-clock adjustments, and clocks on different machines can
still disagree. The plugin does not rewrite backend Dates or user spans, retain
a clock high-water mark across invocations, or promise simultaneous strict
ordering and complete containment across arbitrary clock skew.

Independently of the invocation clock origin, execution-view operation and attempt
exception events use the supplied backend end timestamp when one is available,
just as their span end does. Recording the event at local receipt time can place
it after the backend-ended span. Missing end timestamps retain the normal tracer
default; this does not add rounding or cross-clock ordering policies.

Because the original span context is not checkpointed, replayed `STEP` and
`CONTEXT` spans and cross-invocation continuation spans use new provider IDs.
They correlate through two links: the real exported `Workflow` span, and the
**initial logical operation span** — whose ID is deterministic on
`(operationId, execution ARN)` and lives on the execution trace, so the segments
of one logical operation stay stitched together across invocations. Replay-only
`WAIT`, `INVOKE`, `CHAINED_INVOKE`, and `CALLBACK` operations are not emitted
again.

## Execution Trace and the Execution Ancestor

Both plugins resolve one **execution ancestor** at invocation start — the common
parent the `Workflow` and `Invocation` spans join — so the whole execution
shares a single trace. The ancestor is chosen by precedence:

1. a **complete propagated remote parent** (a valid `Root` trace ID and a valid
   `Parent` span ID): used directly, whether or not `Sampled` is present;
2. otherwise a **synthetic execution root** with a deterministic span ID derived
   from the execution ARN.

The canonical trace ID follows the same precedence: the propagated remote trace
ID when valid, else one derived from the ARN and start time.

A live ambient span (a `context.active()` span created by an auto-instrumentation
layer) is deliberately **never** used as the execution ancestor. Its trace ID is
not guaranteed stable across Lambda reinvocations, so anchoring the
multi-invocation execution on it could change the execution trace ID on replay
and break the cross-invocation continuation and replay links (which target a
deterministic operation span ID on the canonical trace). Both anchors used above
are stable: the durable backend keeps the propagated `Root` identical for every
invocation, and the ARN-derived synthetic root is a pure hash of the ARN.

### Valid Workflow parent shapes

`ADOT` and community Node.js auto-instrumentation layers can create the ambient
handler span before the durable plugin runs, on the trace the durable backend
propagated. OpenTelemetry `SpanContext` has no ancestor pointer, so the plugin
cannot walk from that local span to the durable backend span. The `Workflow`
span therefore joins the canonical trace and parents onto whichever ancestor the
precedence above resolves. When a complete remote parent is propagated, that is
the ancestor:

```text
Propagated remote parent
├── Workflow
└── Invocation
```

When no complete remote parent can be constructed, the synthetic execution root
anchors the trace and the `Workflow` span parents onto it:

```text
Synthetic execution root
└── Workflow
```

The `Invocation` span may still nest under a same-trace ambient handler span —
see [Invocation parent](#invocation-parent) — without changing the execution
ancestor the `Workflow` span joins.

### Synthetic root export lifecycle

When fallback tracing is sampled, the backend supplies `executionStartTimestamp`,
and the configured SDK tracer allows the durable sampler wrapper to be installed,
both views create and end `DurableExecutionRoot` during each invocation's start
hook. Its start and end are both that backend timestamp. The normal
invocation-boundary flush can export it before a `PENDING` or `RETRYING` invocation
returns. A retry with checkpoint history or an intermediate resume can therefore
recover an earlier missing export, including when tracing became available only
after the first invocation. Recovery requires a later sampled invocation to
actually deliver its copy; stopping or timing out before any successful delivery
can still leave the execution without an exported root. This policy does not rely
on `isFirstInvocation`: a retry after checkpointed work runs in replay mode, while
an attempt without that history can still be identified as the first invocation.

Each sampled invocation emits at most one anchor: a terminal invocation does not
emit a second copy if its start hook already created one. Additional copies on
resumes are intentional, allowing consumers to deduplicate by trace ID and span ID.
The SDK-owned span fields are identical when the execution's trace identity,
backend start timestamp and instrumentation configuration remain stable. The
anchor carries `durable.execution.arn`, but no terminal status, request ID or
execution duration; `Workflow` continues to carry the duration and outcome.
`DurableExecutionRoot` is a zero-duration identity span: its descendants end after
it, which some trace viewers or containment validators may flag.

A forwarding tracer that hides the configured sampler retains the existing
terminal-only root creation path. Creating an early root through that tracer would
query the hidden sampler independently and could sample a root after dropping its
Invocation child. The plugin does not add that early sampler call; the underlying
provider still controls sampling, and these tracers do not receive early-anchor
recovery. A terminal backup can recover a missing first export only if a sampled
terminal invocation actually runs and delivers it.

Resources belong to the configured provider. Resource attributes such as
`faas.instance` can differ across execution environments even for identical
anchor span content; backends may retain whichever resource accompanies their
chosen copy. Span processors that enrich these spans must likewise avoid
invocation-varying span fields when relying on identity-based deduplication.
Export delivery and flushing remain the provider/layer's responsibility. The
plugin awaits `forceFlush()` when its provider exposes it, but a killed invocation
or a failed export cannot guarantee delivery; this is not exactly-once export.

If a caller omits `executionStartTimestamp`, the plugin retains terminal-only
synthetic-root materialization with its existing timestamp fallback. It does not
invent a wall-clock-based early anchor. These callers do not get the early-anchor
or identical-timestamp guarantee; the backend timestamp must be consistently
supplied to enable that contract. Complete propagated remote parents are never
materialized by the SDK. With the durable sampler wrapper installed, explicit
`NOT_SAMPLED` executions emit no root.

With the durable sampler wrapper installed, sampling is resolved once per
invocation and the anchor reuses that decision without a second sampler query.
Explicit upstream decisions or a deterministic trace-based policy (for example a
ratio sampler) keep anchor and terminal `Workflow` decisions consistent across
resumes. A non-deterministic custom sampler can select different invocations,
leaving an anchor without a sampled terminal `Workflow`. Decisions are not
persisted. These once-per-invocation guarantees do not apply to an opaque tracer:
its provider can query its sampler independently for each span, including the
existing terminal root; the early-anchor path is skipped to preserve that baseline.

### Workflow identity and lifecycle

`Workflow` is an `INTERNAL` span that **joins the execution trace** by parenting
onto the execution ancestor (its span ID is forced; the trace ID comes from the
parent). Its span ID is reproducible across replays:

- span ID: the first 16 hexadecimal characters of SHA-256 over
  `workflow:<execution ARN>`.

The synthetic execution root, when used, gets a distinct deterministic span ID
from SHA-256 over `execution-root:<execution ARN>`, and the ARN-derived trace ID
is the first 32 hexadecimal characters of SHA-256 over
`<execution ARN>:<execution start timestamp in ISO 8601 format>` (falling back
to the ARN alone when the timestamp is unavailable).

The plugins carry the same `Workflow` span identity on each invocation as a
non-recording span context, and create the single recording `Workflow` span only
when the execution reaches `SUCCEEDED` or `FAILED`, backdated to the execution
start. `PENDING` and `RETRYING` invocations create no recording `Workflow` span,
so none is ever left unended, and one terminal `Workflow` span is exported for the
durable execution while intermediate invocation spans export normally. The
non-recording context carries the execution's sampling decision, so operations
under it are sampled consistently with the eventual root. In-flight attempt spans
are ended at invocation cleanup, so a non-terminal invocation leaves no recording
span unended. Suspended operations differ by plugin: `InvocationOtelPlugin` ends
the open operation span at the boundary and continues it later, while
`ExecutionOtelPlugin` holds the operation identity as a non-recording context and
exports one recording span only when the operation completes.

When a chained parent and target execution share a propagated remote parent,
both join that one trace, each keeping its own deterministic `Workflow` span ID.

### Invocation parent

The `Invocation` span parents onto the **same-trace ambient span** when one is
active on the canonical trace (preserving the Lambda/X-Ray linkage), otherwise
onto the execution ancestor so it stays on the execution trace. Provider
ownership does not change this topology.

### Sampling

Sampling follows this precedence, highest first:

1. **Explicit upstream decision** — an explicit `Sampled=1` / `Sampled=0` in a
   valid propagated header is authoritative and preserved. It is applied only
   when the extracted trace ID is itself valid, so an unusable trace never
   carries its sampling bit into the derived execution trace.
2. **Configured sampler** — when the header carries no usable decision, the
   provider sampler decides. It is evaluated at its **root policy**
   (`ROOT_CONTEXT`, no parent) with the real trace ID, span name, and attributes,
   so a `ParentBasedSampler` applies its `root` sampler rather than inheriting an
   unrelated ambient span's decision.
3. **Default to sampled** — used only when no sampler decision can be obtained.

The resolved execution decision is enforced for all SDK-created spans through a
durable sampler wrapper around the provider sampler. This makes explicit backend
sampling authoritative even for direct/custom samplers that ignore parent
`traceFlags`. Unrelated application spans still use the original configured
sampler. If the resolved tracer does not expose a compatible writable sampler,
the plugin preserves normal tracing through the configured provider; in that
case direct samplers may make their normal span-level decisions.

### Context extractors

The default `xRayContextExtractor` parses `Root`, `Parent`, and `Sampled`
independently from `_X_AMZN_TRACE_ID`, rejecting an all-zero (invalid) `Root` or
`Parent`. The durable backend keeps the X-Ray `Root` stable for every invocation
of one execution, so its trace ID anchors the whole execution. The package also
exports `w3cClientContextExtractor`, which reads W3C `traceparent` data from
`context.clientContext.custom.traceparent`.

A custom extractor can return:

```typescript
type Sampling = "SAMPLED" | "NOT_SAMPLED" | "UNDECIDED";

type ContextExtractor = (info: InvocationInfo) =>
  | {
      traceId: string;
      parentSpanId?: string;
      traceFlags?: number;
      sampling?: Sampling;
    }
  | undefined;
```

A complete remote parent needs a valid `traceId` and a valid `parentSpanId`.
`sampling` is the tri-state upstream decision; when omitted it is derived from
`traceFlags` (sampled bit), and when neither is present the decision is
`UNDECIDED` and the sampling rules above decide. A custom extractor must return
the durable execution's own trace context: a valid trace ID anchors the
execution across replays, so returning stale or per-invocation context (for
example an ambient span that changes each invocation) would split one durable
execution across traces.

## Shared Configuration

Both plugins accept `OtelPluginConfig`:

```typescript
interface OtelPluginConfig {
  /** Creates an application-owned provider with a deterministic ID wrapper. */
  tracerProviderFactory?: (
    createIdGenerator: (fallbackIdGenerator?: IdGenerator) => IdGenerator,
  ) => TracerProvider;

  /** Extracts upstream trace context. Defaults to xRayContextExtractor. */
  contextExtractor?: ContextExtractor;

  /** Instrumentation scope name. */
  instrumentationName?: string;

  /** Custom Workflow span name. Defaults to "Workflow". */
  workflowSpanName?: string;

  /** Add active OTel IDs to durable log records. Defaults to true. */
  enrichLogger?: boolean;
}
```

Provider selection is implicit:

- omit `tracerProviderFactory` to use the global provider;
- provide `tracerProviderFactory` to use the returned application-owned
  provider.

The default instrumentation scope name is
`aws-durable-execution-sdk-js`.

## Spans, Attributes, and Status

All plugin-created spans use `SpanKind.INTERNAL`.

- **Workflow:** Named by `workflowSpanName`, which defaults to `Workflow`.
  Carries `durable.execution.arn` and, when terminal,
  `durable.execution.status`.
- **Invocation:** Named `Invocation`. Carries `durable.execution.arn`,
  `durable.invocation.first`, and `durable.invocation.status`.
- **Operation:** Named from the configured operation name, or the operation
  type when unnamed. Carries `durable.execution.arn`,
  `durable.operation.id`, `durable.operation.type`, optional
  `durable.operation.name`, and optional `durable.operation.subtype`.
  `InvocationOtelPlugin` sets `durable.operation.status=STARTED` at span
  creation; both plugins apply a supplied terminal operation status at
  completion. `durable.attempt.number` is added to `STEP` and
  `WAIT_FOR_CONDITION` operation spans when supplied.
- **Attempt:** Named `<operation name or type> attempt <number>`. Carries the
  operation identity attributes, `durable.attempt.number`, and terminal
  `durable.attempt.outcome`. Attempt spans do not carry
  `durable.operation.status`.

For `ExecutionOtelPlugin` with an application-owned provider, Invocation also
adds `cloud.resource_id` and `faas.max_memory` when the corresponding Lambda
environment values are available.

OpenTelemetry status mapping is:

| Span       | Durable result                                                     | OTel status              |
| ---------- | ------------------------------------------------------------------ | ------------------------ |
| Workflow   | `SUCCEEDED` / `FAILED`                                             | `OK` / `ERROR`           |
| Invocation | `SUCCEEDED` or `PENDING` / `FAILED` / `RETRYING`                   | `OK` / `ERROR` / `UNSET` |
| Operation  | `SUCCEEDED` / error object / other failure without an error object | `OK` / `ERROR` / `UNSET` |
| Attempt    | `FAILED` / any other outcome                                       | `ERROR` / `OK`           |

Operation and attempt errors are recorded as exception events when an error
object is available. Workflow and Invocation failures set an `ERROR` status and
status message without recording an exception event.

An external callback failure with no error details leaves the callback leaf
`UNSET`; an empty wire error object does not synthesize a plugin error. Explicit
partial details, including empty strings or an empty stack trace, still count as
provided error information. The callback promise continues to reject with the
same callback error, so its enclosing context or invocation may record its own
failure. Checkpoint payloads, operation status, and replay behavior are unchanged.

## Log Correlation

When `enrichLogger` is enabled, durable log records receive the currently
active OpenTelemetry `traceId`, `spanId`, and `otelTraceSampled` values.
Outside an active span, no fields are added.

Disable enrichment when another logging integration already injects equivalent
fields:

```typescript
const plugin = new ExecutionOtelPlugin({
  enrichLogger: false,
});
```

For `ExecutionOtelPlugin`, handler-level logs correlate with Workflow. For
`InvocationOtelPlugin`, handler-level logs correlate with Invocation. Logs
inside child contexts and attempts correlate with their active operation or
attempt span.

## Public API

### Plugins

```typescript
new ExecutionOtelPlugin(config?: OtelPluginConfig);
new InvocationOtelPlugin(config?: OtelPluginConfig);
```

### Provider Types

```typescript
type IdGeneratorFactory = (fallbackIdGenerator?: IdGenerator) => IdGenerator;

type TracerProviderFactory = (
  createIdGenerator: IdGeneratorFactory,
) => TracerProvider;
```

### `DeterministicIdGenerator`

An OpenTelemetry `IdGenerator` with `AsyncLocalStorage`-scoped deterministic
overrides. `withIds()` applies optional trace and span IDs only while its
synchronous callback starts a span. The span ID override is consumed after its
first use. All other ID generation delegates to the fallback generator.

```typescript
const generator = new DeterministicIdGenerator(fallbackIdGenerator);

const span = generator.withIds(
  { traceId: executionTraceId, spanId: deterministicSpanId },
  () => tracer.startSpan("operation"),
);
```

### ID Helpers

```typescript
deriveTraceIdFromArn(
  executionArn: string,
  executionStartTimestamp?: Date,
): string;

deriveTraceIdFromXRayRoot(xRayRoot: string): string | undefined;

deriveExecutionTraceId(
  environment: ExecutionTraceEnvironment,
  executionArn: string,
  executionStartTimestamp?: Date,
): string;

deriveWorkflowSpanId(executionArn: string): string;

deriveExecutionRootSpanId(executionArn: string): string;

deriveSpanIdFromOperationId(
  operationId: string,
  executionArn: string,
): string;
```

`deriveTraceIdFromArn` returns a 32-character hexadecimal trace ID.
`deriveTraceIdFromXRayRoot` converts a valid X-Ray `Root` value to an
OpenTelemetry trace ID and returns `undefined` for invalid input.
`deriveExecutionTraceId` applies the default plugin precedence to an explicit
environment: a valid `_X_AMZN_TRACE_ID` `Root` wins, otherwise it uses the same
ARN-and-start-time fallback as the plugins. Pass `process.env` in Lambda or a
plain object in tests. When no valid X-Ray Root is available, pass the same
execution start timestamp supplied to the plugin; omit it only when it is
unavailable to both callers.
`deriveWorkflowSpanId` hashes `workflow:<execution ARN>`,
`deriveExecutionRootSpanId` hashes `execution-root:<execution ARN>` (a distinct
namespace so the synthetic root never collides with the Workflow or operation
spans on the shared trace), and `deriveSpanIdFromOperationId` hashes
`<execution ARN>:<operation ID>`. All three span helpers return 16-character
hexadecimal IDs.

Wrapper-style instrumentation can create spans on the same execution trace and
refer to the same Workflow span without copying the plugin's derivations:

```typescript
import {
  deriveExecutionTraceId,
  deriveWorkflowSpanId,
} from "@aws/durable-execution-sdk-js-otel";

const executionTraceId = deriveExecutionTraceId(
  process.env,
  executionArn,
  executionStartTimestamp,
);
const workflowSpanId = deriveWorkflowSpanId(executionArn);
```

### Context Extractors

```typescript
xRayContextExtractor(info: InvocationInfo): ContextExtractorResult;
w3cClientContextExtractor(info: InvocationInfo): ContextExtractorResult;
```

The package also exports the `ContextExtractor`, `ContextExtractorResult`,
`ExecutionTraceEnvironment`, `IdGeneratorFactory`, `TracerProviderFactory`, and
`OtelPluginConfig` types.

### External completions and replay

Both views retain terminal wait, invoke, and callback notifications received at
invocation start or in checkpoint responses. If workflow traversal does not
reach a completed operation before suspending or returning, its completion is
exported at invocation end. Supplied operation timestamps, parent identity,
status, and error details are preserved in the execution view; the invocation
view completes the live segment or emits a linked continuation.

A failed invoke still rejects with `InvokeError` when backend error details are
absent. Its telemetry retains the absent error metadata in live, resumed, and
deferred delivery, rather than inventing an exception. Provided error details
continue through the existing metadata converter.

For a named `waitForCallback`, a deferred inner callback recovers its derived
`<name>-callback` display name from a known `WaitForCallback` parent when replay
skips that branch. This does not change checkpointed names, operation identity,
parent identity, or the source notification; explicit names remain unchanged.

At a terminal invocation boundary, the execution view parents a deferred
completion to `Workflow` if its direct parent is still an open local placeholder
that will be discarded. It does not invent a completion or span for that
abandoned context. Pending or retrying invocations retain the parent identity
because a later invocation can still complete and export that context.

Notifications and operation-end hooks are deduplicated within each invocation.
Normal replay does not re-export stored external completions. Deduplication is
not persisted: redelivery after a failed invocation can export the completion
again, as required for recovery.

## Verification and Troubleshooting

After deployment:

1. Invoke a durable function with multiple steps or a wait/resume cycle.
2. Verify Invocation spans and completed operation spans appear after enabled
   invocations.
3. Verify one Workflow span appears after the execution becomes terminal.
4. Expect the Workflow span, every Invocation span, and the operation/attempt
   spans to share one execution trace ID.
5. Confirm the documented cross-links connect the workflow and invocation views.
6. Confirm unrelated root spans retain provider-generated trace IDs.
7. Verify durable log records contain correlation fields when
   `enrichLogger` is enabled.

If no plugin spans appear:

- confirm a compatible SDK provider is registered before invocation start, or
  return one through `tracerProviderFactory`;
- confirm the provider has a span processor and exporter;
- check for the plugin warning that says telemetry was disabled because the
  global tracer was incompatible;
- remember that dynamic loading supports only the global-provider path;
- remember that Workflow is not exported until `SUCCEEDED` or `FAILED`.

One execution trace is expected. The Workflow span and every per-invocation
Invocation span share it, anchored at the execution ancestor (the propagated
remote parent, or a synthetic execution root).

## License

Apache-2.0

## Core compatibility

OTel 1.2 preserves valid core 2.4–2.x registrations, including separate
OTel-only Lambda layers. Its core peer is optional (`>=2.4.0 <3.0.0`), and the
dynamic provider contract remains version 1. Existing on-demand environment
carrier behavior remains available on older cores; upgrading the plugin alone
does not add fields to the invocation metadata those cores supply.

The new invocation-local LMI carrier and core registration exclusivity require
the coordinated core 2.7 / OTel 1.2 pair. Upgrade both for those capabilities.
Older core/plugin combinations do not gain those guarantees. The two OTel views
remain an unsupported combination, and the updated core rejects it with updated
plugin metadata. The later core 3 factory migration is a separate major release.

Instrumentation error details are optional even for failed operations. The core
metadata correction for an empty callback error payload no longer invents an
error object. API-v1 plugins that previously used only `OperationInfo.error`
presence as a failure signal should use `OperationInfo.status` instead (and
`AttemptEndInfo.outcome` for an attempt). Missing error details do not imply a
successful operation; supplied partial or explicitly empty detail fields are
retained. This does not change the provider/hook shape, callback rejection,
persisted error payload, or replay identity.

Registration metadata uses the namespaced symbol
`Symbol.for("aws.lambda.durable.instrumentation.plugin-registration")`.
The bundled views declare it on their constructors, so the core can validate
all selected provider types before calling any environment-selected factory.
Conflicting dynamic views therefore do not install sampler or ID-generator
wrappers on the global tracer. Subclasses retain all inherited static exclusive
groups; declaring their own static metadata adds a constraint and cannot replace
an inherited one. Repeating a group within one constructor chain does not count
as a second plugin registration. Subclasses are identified by their actual
constructor names in diagnostics. Explicit instances
have already been constructed by the application before registration; validation
cannot undo that construction. Existing instance metadata remains supported and
returned instances are checked too, including subclasses returned by providers
that declare a broader base type.
The base hook interface stays unchanged, and ordinary properties such as a
custom plugin's `registration` field are not interpreted by the SDK. This keeps
existing valid plugin classes and generic hook dispatchers source-compatible.
