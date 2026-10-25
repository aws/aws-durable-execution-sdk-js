# SDK 3.0.0 / OTel 2.0.0 / Testing SDK 1.3.2 release draft

This draft describes changes merged through
[`e48a9d6a`](https://github.com/aws/aws-durable-execution-sdk-js/commit/e48a9d6acfce798746011427a2f9d5ffcc8cef5f).
These versions have not been published by this preparation PR. Refresh the
source range and pending-work table against the commit selected for the final
release.

For application upgrade steps, see the [2.x to 3.0 migration guide](../docs/migration-2.x-to-3.0.md),
including dependency versions, before/after plugin examples, and validation.

## Package versions and publication scope

| Package | Prepared version | Public npm state checked 2026-10-25 | Existing publisher decision |
| --- | --- | --- | --- |
| `@aws/durable-execution-sdk-js` | `3.0.0` | `latest` is `2.7.1` | Publish to `latest` |
| `@aws/durable-execution-sdk-js-otel` | `2.0.0` | `latest` is `1.2.1` | Publish to `latest` |
| `@aws/durable-execution-sdk-js-testing` | `1.3.2` | `latest` is `1.3.1` | Publish to `latest` |
| `@aws/durable-execution-sdk-js-eslint-plugin` | `1.1.1` | `1.1.1` is already published | Skip |
| `@aws/durable-execution-sdk-js-telemetry-exporter` | `0.1.0-alpha.0` | `0.1.0-alpha.0` is already published, on `latest` | Skip |
| `@aws/durable-execution-sdk-js-telemetry-mcp` | `0.1.0-alpha.0` | `0.1.0-alpha.0` is already published, on `latest` | Skip |

The versions and workspace lock entries were already prepared on `main` by
#924. Testing SDK 1.3.2 is a compatible patch with a Core 3 peer range; it is not
promoted to a new major. The publisher chooses each dist-tag from the package
version, independently of the GitHub Release prerelease checkbox. It skips a
version that npm already has.

The two Telemetry packages were published on 2026-10-22, outside this release
workflow. npm records their `gitHead` as `6597e075`, the #924 merge commit. So
the published `0.1.0-alpha.0` contains none of the Telemetry fixes listed below.
So this release publishes those fixes only if their versions are bumped first,
for example to `0.1.0-alpha.1`. The published exporter also declares the Core
peer `>=3.0.0 <4.0.0` as required. Core 3 is not on npm until this release. So
npm cannot satisfy that peer until then.

The ESLint plugin has the same gap. `1.1.1` was published on 2026-08-14. The new
rule from #1093 and #1096 is on `main` under version `1.1.1`. So the publisher
skips it. Shipping the rule needs a minor bump, to `1.2.0`, before the release
commit is selected.

Extras and MicroVM Worker remain explicitly excluded from automatic publishing.
Their changes on `main` (#1042, #1048, #1049, #1055, #1060, #1069, #1076, #1077,
#1079, #1080, #1081, #1088, #1089) are not published by this release. The VS
Code extension continues to use its separate VSIX release process.

Use the exact tag **`sdk-3.0.0`** for Lambda managed-runtime rollout, with release
title **`sdk-3.0.0 / otel-2.0.0 / test-1.3.2`**. Publishing a GitHub Release emits
`release.published` and starts `npm-publish.yml`, which builds/tests the tag and
considers every package in its existing list. Creating or merging this PR does
not create that tag or publish packages.

## Work not included in this source snapshot

| PR | Scope | Release-note treatment |
| --- | --- | --- |
| [#1014](https://github.com/aws/aws-durable-execution-sdk-js/pull/1014) | Invocation admission, deadline and cleanup fixes | Open at preparation time; not described as shipped below |
| [#1035](https://github.com/aws/aws-durable-execution-sdk-js/pull/1035) | Plugin wrapper failure containment for wrapper getters and thenables | Open at preparation time. #1067 already covers a `wrap` hook that rejects on its own (see below). Its agreed external PromiseLike follow-up [#1037](https://github.com/aws/aws-durable-execution-sdk-js/issues/1037) remains separate |
| [#928](https://github.com/aws/aws-durable-execution-sdk-js/pull/928) | Persistent LMI regression harness and acceptance evidence | Open at preparation time; adds tests, not the SDK runtime remediation |

Update this table and the package notes if these changes land before the release
commit is selected. Per-invocation instrumentation isolation does not by itself
cancel detached business work. Fresh Core 3 acceptance of the #1014/#928
composition is separate from earlier Core 2 cloud results; its current catalog
contains 25 example tests and 12 lifecycle cases. No cloud result is claimed by
this release-preparation document.

# @aws/durable-execution-sdk-js 3.0.0

## What's changed

- Create instrumentation plugins once per invocation, isolating execution
  identity and mutable plugin state across concurrent Lambda Managed Instances
  requests ([#924](https://github.com/aws/aws-durable-execution-sdk-js/pull/924)).
- Forward the invocation-local `context.xRayTraceId` carrier to factory and hook
  metadata. A present empty, nullish, invalid or unreadable carrier suppresses a
  stale process header; an absent carrier preserves environment fallback (#924).
- Add `createPowertoolsLogger`, `PowertoolsDurableLogger` and
  `PowertoolsLoggerLike` for Powertools logging with durable context and plugin
  enrichment ([#1023](https://github.com/aws/aws-durable-execution-sdk-js/pull/1023)).
- Resolve reused logger identity from the active execution context
  ([#1028](https://github.com/aws/aws-durable-execution-sdk-js/pull/1028)).
- Stop awaiting operation plugin hooks. A slow hook no longer delays the next
  operation or lets the invocation suspend early. The SDK drains the hook work
  before `onInvocationEnd`, within deadline bounds
  ([#1067](https://github.com/aws/aws-durable-execution-sdk-js/pull/1067)). See
  the breaking changes below.
- Continue the invocation when a `wrap` hook rejects for its own reasons, for
  example after the customer function succeeded. An error from the customer
  function still reaches the caller (#1067).
- Keep the invocation from suspending while a `wrapChildContextFn` hook does
  asynchronous work after the child function settles (#1067).
- Treat a Lambda context whose `getRemainingTimeInMillis` is missing, throws, or
  returns a non-finite value as reporting no deadline. Before, `ctx.wait` and
  step retries failed the invocation with such a context, even without a plugin
  (#1067).
- Graduate the instrumentation plugin interface. The plugin info types, the
  factory and registration types, `DurableExecutionConfig.plugins`,
  `pluginsConfig` and `PluginLoadError` are no longer `@experimental` or `@beta`
  ([#1072](https://github.com/aws/aws-durable-execution-sdk-js/pull/1072)).
- Keep an operation `EXECUTING` while its result is deserialized. This covers
  `step`, `waitForCondition`, `invoke`, `createCallback`, `runInChildContext`,
  `map`, `parallel` and `waitForCallback`. Before, a deserializer slower than the
  termination cooldown could let the invocation suspend next to a pending
  callback. The code after the operation then did not run in that invocation
  ([#1065](https://github.com/aws/aws-durable-execution-sdk-js/pull/1065)).
- Lower the checkpoint termination cooldown from 20 ms to 3 ms. Each idle
  invocation ends about 17 ms sooner
  ([#1064](https://github.com/aws/aws-durable-execution-sdk-js/pull/1064)).
- Name the `cause` of a failed `context.invoke` after the invoked function's
  error type, with the remote stack trace. Before, `cause.name` was always
  `"Error"`. The top-level `InvokeError` name is unchanged
  ([#1054](https://github.com/aws/aws-durable-execution-sdk-js/pull/1054)).
- Let the invocation suspend after a `map` or `parallel` completes early, or
  after a child context returns while a step it started is still running.
  Before, the abandoned step stayed `EXECUTING`. So a later `wait` or callback
  ran until the Lambda timeout
  ([#1090](https://github.com/aws/aws-durable-execution-sdk-js/pull/1090),
  [ADR 0002](../docs/adr/0002-abandoned-operations-stop-executing.md)).
- Keep every recorded item outcome when a `map` or `parallel` resumes after an
  invocation ended between the item checkpoints and the batch checkpoint. Stop
  starting items after the batch has resolved
  ([#1091](https://github.com/aws/aws-durable-execution-sdk-js/pull/1091)).
- Document what happens to `map` and `parallel` items after early completion
  ([#1092](https://github.com/aws/aws-durable-execution-sdk-js/pull/1092)).

## Breaking changes and migration

`DurableExecutionConfig.plugins` now accepts factory objects with a synchronous
`createPlugin(info)` method. Return a fresh plugin for each invocation. Keep
shared providers/exporters outside that instance and invocation buffers/maps
inside it. Returning `null` or `undefined` skips instrumentation for that
invocation; an asynchronous factory result is not supported.

Replace registration of a long-lived plugin instance with a factory:

```typescript
import {
  withDurableExecution,
  type DurableInstrumentationPluginFactory,
} from "@aws/durable-execution-sdk-js";

const auditFactory: DurableInstrumentationPluginFactory = {
  createPlugin() {
    const operationIds = new Set<string>();
    return {
      async onOperationEnd(operation) {
        operationIds.add(operation.id);
      },
      async onInvocationEnd() {
        operationIds.clear();
      },
    };
  },
};

export const handler = withDurableExecution(
  async (_event, context) => context.step("work", async () => "ok"),
  { plugins: [auditFactory] },
);
```

The factory receives the same `InvocationInfo` object as `onInvocationStart`.
Environment-loaded modules still export `durableExecutionPluginProvider`, now
with the factory shape. Remove legacy `pluginApiVersion` and `pluginType`
metadata after migrating. Declared v1 providers and instance registrations fail
with `PluginLoadError`; they are not silently assigned a different lifetime.
Upgrade application registrations and Lambda layers together.

If you copied the former Powertools example, update log queries from snake_case
keys to the adapter's `executionArn`, `requestId`, `operationId` and
`operationName` fields. See the [SDK logging guide](../packages/aws-durable-execution-sdk-js/README.md).

### Operation hooks are no longer awaited

The SDK no longer awaits `onOperationStart`, `onOperationEnd`,
`onOperationAttemptStart`, `onOperationAttemptEnd` or `onOperationChange` (#1067).

1. The synchronous part of each hook still runs before the SDK continues, in
   call order.
2. The asynchronous parts of consecutive hooks can overlap. A plugin that needs
   them in order must queue the work itself.
3. Before `onInvocationEnd`, the SDK waits for earlier hook work until 500 ms
   before the invocation's deadline. It then waits for `onInvocationEnd` until
   50 ms before the deadline. Work still pending is abandoned.
4. `onInvocationEnd` is now called after that drain, not at the moment the
   invocation ends.

`onInvocationStart` and the `wrap` hooks are unchanged. The shipped OTel and
Telemetry plugins already work this way. See
[Adapt operation hook scheduling](../docs/migration-2.x-to-3.0.md#adapt-operation-hook-scheduling).

### Other behavior changes

- A deserializer that fails after the cooldown now fails the invocation with
  `SerdesFailedError`. Before, the invocation could return `PENDING` and the
  failure was not reported (#1065).
- An operation now holds the invocation open while it finishes. So a
  deserializer that never settles keeps the invocation open until the Lambda
  timeout. For a child context, the same holds for its serializer and its
  `onOperationEnd` hook (#1065).
- The cooldown is also the time that untracked asynchronous work between two
  operations gets before the invocation suspends. An example is an `await` in
  handler code on a dynamic `import()` or a file read. That limit drops from
  about 20 ms to about 3 ms. Code after such a gap runs again on the next
  invocation (#1064).
- Code that reads `cause.name` of a failed `context.invoke` now receives the
  remote error type instead of `"Error"` (#1054).

**Full changelog:** [sdk-2.7.1...e48a9d6a](https://github.com/aws/aws-durable-execution-sdk-js/compare/sdk-2.7.1...e48a9d6acfce798746011427a2f9d5ffcc8cef5f).

# @aws/durable-execution-sdk-js-otel 2.0.0

## What's changed

- Keep spans, operation maps, replay state and invocation clocks on each plugin
  instance, while sharing the intentionally environment-owned provider (#924).
- Extract trace and sampling data from the same invocation-local carrier that
  `deriveExecutionTraceId` can receive as its fourth argument (#924).
- Preserve chained-invoke propagation, replay export suppression, terminal error
  status without invented exception details, and bounded final metadata flushes
  while moving to factories (#924).
- Report `faas.max_memory` on the execution view's Invocation span in bytes, as
  the semantic conventions define it. Before, it reported the Lambda memory
  setting in MiB
  ([#1074](https://github.com/aws/aws-durable-execution-sdk-js/pull/1074)).

## Breaking changes and migration

Use `createExecutionOtelPluginFactory` or `createInvocationOtelPluginFactory`
in place of constructing the former OTel plugin classes. Choose one view for a
handler; the two views remain mutually exclusive. OTel 2 requires the matching
Core 3 contract (`>=3.0.0 <4.0.0`), including for separate Lambda layers.

```typescript
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { createExecutionOtelPluginFactory } from "@aws/durable-execution-sdk-js-otel";

export const handler = withDurableExecution(
  async (_event, context) => context.step("work", async () => "ok"),
  { plugins: [createExecutionOtelPluginFactory()] },
);
```

`flushTimeoutMillis` bounds the wait for export; it does not guarantee delivery
after timeout, exporter failure or runtime freezing. One invocation's cleanup
does not shut down a shared provider or another invocation's plugin instance.
See the [OTel migration guide](../packages/aws-durable-execution-sdk-js-otel/README.md#migration-from-the-v1-provider-contract).

A 1024 MiB function now reports `faas.max_memory` as `1073741824`, not `1024`.
So update any query or alarm that reads this attribute (#1074).

**Full changelog:** [sdk-2.7.1...e48a9d6a](https://github.com/aws/aws-durable-execution-sdk-js/compare/sdk-2.7.1...e48a9d6acfce798746011427a2f9d5ffcc8cef5f), from the release containing OTel 1.2.1.

# @aws/durable-execution-sdk-js-testing 1.3.2

## What's changed

- Accept Core 3 while retaining the supported `>=1.0.1 <4.0.0` peer range (#924).
- Fence queued wakeups when an invocation has settled, preserving final history
  collection without starting an extra invocation
  ([#1020](https://github.com/aws/aws-durable-execution-sdk-js/pull/1020)).
- Update cloud-runner operation storage before notifying history waiters
  ([#1033](https://github.com/aws/aws-durable-execution-sdk-js/pull/1033)).
- Keep skip-time checkpoint timestamps, sequential/parallel delays and nested
  invocation scheduling on the runner's clock
  ([#1013](https://github.com/aws/aws-durable-execution-sdk-js/pull/1013)).
- Stop an abandoned durable invoke from holding its caller's fake clock
  ([#1034](https://github.com/aws/aws-durable-execution-sdk-js/pull/1034)).
- Keep advancing skip-time after an invoked or detached runner's clock hold
  expires. Before, an abandoned child with a step that never settles could make
  the caller's remaining wait take real time
  ([#1043](https://github.com/aws/aws-durable-execution-sdk-js/pull/1043)).

When upgrading tests, use Testing SDK 1.3.2 with Core 3. A timer created by
business code inside a step runs in real time; use a durable wait when testing a
durable delay. Corrected scheduling can change recorded invocation counts and
history ordering. The [detailed changelog](../CHANGELOG.md) describes the clock
behavior and the bounds around unresolved invocations.

**Full changelog:** [sdk-2.7.0...e48a9d6a](https://github.com/aws/aws-durable-execution-sdk-js/compare/sdk-2.7.0...e48a9d6acfce798746011427a2f9d5ffcc8cef5f), from the release containing Testing SDK 1.3.1.

# @aws/durable-execution-sdk-js-telemetry-exporter 0.1.0-alpha.0

This release does not publish this package. `0.1.0-alpha.0` is already on npm,
built from the #924 merge commit. The `durableExecutionTelemetry()` API returns
a Core 3 plugin factory with invocation-owned buffers and shared serialized
exports. The package remains a preview, not a stable 1.0 release. The declared
Core peer is `>=3.0.0 <4.0.0`.

The inherited eager imports of exporter integrations still require their
optional AWS peer packages to be available when importing the package. Follow
the [exporter installation guidance](../packages/aws-durable-execution-sdk-js-telemetry-exporter/README.md#installation)
for bundled or non-Lambda applications.

## Unpublished changes on `main`

These changes reach npm only after a version bump:

- Write every error's cause chain as `{ name, message, cause? }`, cut after 16
  levels. Mark a record whose causes were removed to fit a size limit with
  `droppedCauses: true`
  ([#1059](https://github.com/aws/aws-durable-execution-sdk-js/pull/1059),
  [#1063](https://github.com/aws/aws-durable-execution-sdk-js/pull/1063)).
- Replace an SQS FIFO `MessageGroupId` or `MessageDeduplicationId` longer than
  128 characters with its SHA-256 hex digest. Before, SQS rejected these sends
  for most execution ARNs (#1059).
- Make `emittedAt` strictly increase within an invocation. Before, two records
  in the same millisecond collided on the SQS deduplication id and on the
  DynamoDB default sort key
  ([#1071](https://github.com/aws/aws-durable-execution-sdk-js/pull/1071)).

The CDK stack is not part of the npm package. Its fixes are available from the
repository: the `droppedcauses` Athena column (#1063), `timestamp` Athena time
columns ([#1070](https://github.com/aws/aws-durable-execution-sdk-js/pull/1070)),
case-preserving Athena keys, a configurable Aurora engine version that defaults
to `17.9`, wider Aurora `execution_arn` and `execution_name` columns
([#1075](https://github.com/aws/aws-durable-execution-sdk-js/pull/1075)), and a
synth-time Aurora engine version check
([#1078](https://github.com/aws/aws-durable-execution-sdk-js/pull/1078)). A
table created by an earlier stack keeps its old column types and key case; the
[detailed changelog](../CHANGELOG.md) describes how to update it.

# @aws/durable-execution-sdk-js-telemetry-mcp 0.1.0-alpha.0

This release does not publish this package. `0.1.0-alpha.0` is already on npm,
built from the #924 merge commit. Use
`@aws/durable-execution-sdk-js-telemetry-mcp` and its `durable-telemetry-mcp`
command. The private telemetry-core workspace is bundled rather than required
from npm at runtime. The package remains a preview and requires Node.js 22.12.0
or later. See the [MCP package guide](../packages/aws-durable-execution-sdk-js-telemetry-mcp/README.md).

## Unpublished changes on `main`

These changes reach npm only after a version bump:

- Validate `since` and `until` in `list_executions`, and read a bound with no
  offset as UTC. On DynamoDB and CloudWatch Logs, rewrite a bound to the stored
  timestamp format (#1070).
- Use the bundled Athena DDL with `timestamp` time columns, case-preserving keys
  and the `droppedcauses` column (#1063, #1070, #1075).
- Stop requiring `DURABLE_TELEMETRY_ATHENA_S3_LOCATION` in `test_destination`
  for the `s3` destination (#1075).

# @aws/durable-execution-sdk-js-eslint-plugin 1.1.1

This release does not publish this package. `1.1.1` is already on npm. These
changes on `main` reach npm only after a minor bump:

- Add the `require-durable-operation-in-child-context` rule. It reports a
  `runInChildContext` function, a `map` function or a `parallel` branch that
  calls no durable operation on its context. It is not in `flat/recommended`
  ([#1093](https://github.com/aws/aws-durable-execution-sdk-js/pull/1093)).
- Read the effective `func` of a `parallel` branch object, make the rule's answer
  independent of declaration order, and find durable contexts in linear passes
  instead of factorial time
  ([#1096](https://github.com/aws/aws-durable-execution-sdk-js/pull/1096)).
