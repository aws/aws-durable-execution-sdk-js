# SDK 3.0.0 / OTel 2.0.0 / Testing SDK 1.3.2 release draft

This draft describes changes merged through
[`85fc08d1`](https://github.com/aws/aws-durable-execution-sdk-js/commit/85fc08d1bd5863b8b49c165217fc93d9cae84763).
These versions have not been published by this preparation PR. Refresh the
source range and pending-work table against the commit selected for the final
release.

For application upgrade steps, see the [2.x to 3.0 migration guide](../docs/migration-2.x-to-3.0.md),
including dependency versions, before/after plugin examples, and validation.

## Package versions and publication scope

| Package | Prepared version | Public npm state checked 2026-10-21 | Existing publisher decision |
| --- | --- | --- | --- |
| `@aws/durable-execution-sdk-js` | `3.0.0` | `latest` is `2.7.1` | Publish to `latest` |
| `@aws/durable-execution-sdk-js-otel` | `2.0.0` | `latest` is `1.2.1` | Publish to `latest` |
| `@aws/durable-execution-sdk-js-testing` | `1.3.2` | `latest` is `1.3.1` | Publish to `latest` |
| `@aws/durable-execution-sdk-js-eslint-plugin` | `1.1.1` | This version is already published | Skip |
| `@aws/durable-execution-sdk-js-telemetry-exporter` | `0.1.0-alpha.0` | New name returns E404 | First-publication attempt on `beta` |
| `@aws/durable-execution-sdk-js-telemetry-mcp` | `0.1.0-alpha.0` | New name returns E404 | First-publication attempt on `beta` |

The versions and workspace lock entries were already prepared on `main` by
#924. Testing SDK 1.3.2 is a compatible patch with a Core 3 peer range; it is not
promoted to a new major. The preview packages retain their existing alpha
versions. The publisher chooses `beta` for prereleases from their versions,
independently of the GitHub Release prerelease checkbox.

The old `@aws/durable-execution-sdk-js-insight` and
`@aws/durable-execution-sdk-js-insight-mcp` names have published
`0.1.0-alpha.0` versions. That does not establish publisher setup for the new
Telemetry names. E404 establishes no public metadata at the checked name; it
does not identify the cause or verify npm publishing permissions. Confirm the
renamed packages' first-publication setup as part of the release preflight.
Extras and MicroVM Worker remain explicitly excluded from automatic publishing;
the VS Code extension continues to use its separate VSIX release process.

Use the exact tag **`sdk-3.0.0`** for Lambda managed-runtime rollout, with release
title **`sdk-3.0.0 / otel-2.0.0 / test-1.3.2`**. Publishing a GitHub Release emits
`release.published` and starts `npm-publish.yml`, which builds/tests the tag and
considers every package in its existing list. Creating or merging this PR does
not create that tag or publish packages.

## Work not included in this source snapshot

| PR | Scope | Release-note treatment |
| --- | --- | --- |
| [#1014](https://github.com/aws/aws-durable-execution-sdk-js/pull/1014) | Invocation admission, deadline and cleanup fixes | Open at preparation time; not described as shipped below |
| [#1035](https://github.com/aws/aws-durable-execution-sdk-js/pull/1035) | Plugin wrapper failure containment | Open at preparation time; its agreed external PromiseLike follow-up [#1037](https://github.com/aws/aws-durable-execution-sdk-js/issues/1037) remains separate |
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

**Full changelog:** [sdk-2.7.1...85fc08d1](https://github.com/aws/aws-durable-execution-sdk-js/compare/sdk-2.7.1...85fc08d1bd5863b8b49c165217fc93d9cae84763).

# @aws/durable-execution-sdk-js-otel 2.0.0

## What's changed

- Keep spans, operation maps, replay state and invocation clocks on each plugin
  instance, while sharing the intentionally environment-owned provider (#924).
- Extract trace and sampling data from the same invocation-local carrier that
  `deriveExecutionTraceId` can receive as its fourth argument (#924).
- Preserve chained-invoke propagation, replay export suppression, terminal error
  status without invented exception details, and bounded final metadata flushes
  while moving to factories (#924).

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

**Full changelog:** [sdk-2.7.1...85fc08d1](https://github.com/aws/aws-durable-execution-sdk-js/compare/sdk-2.7.1...85fc08d1bd5863b8b49c165217fc93d9cae84763), from the release containing OTel 1.2.1.

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

When upgrading tests, use Testing SDK 1.3.2 with Core 3. A timer created by
business code inside a step runs in real time; use a durable wait when testing a
durable delay. Corrected scheduling can change recorded invocation counts and
history ordering. The [detailed changelog](../CHANGELOG.md) describes the clock
behavior and the bounds around unresolved invocations.

**Full changelog:** [sdk-2.7.0...85fc08d1](https://github.com/aws/aws-durable-execution-sdk-js/compare/sdk-2.7.0...85fc08d1bd5863b8b49c165217fc93d9cae84763), from the release containing Testing SDK 1.3.1.

# @aws/durable-execution-sdk-js-telemetry-exporter 0.1.0-alpha.0

First release under the renamed Telemetry Exporter package name. The
`durableExecutionTelemetry()` API returns a Core 3 plugin factory with
invocation-owned buffers and shared serialized exports. It remains a preview
published on `beta`, not a stable 1.0 release. The declared Core peer is
`>=3.0.0 <4.0.0`.

The inherited eager imports of exporter integrations still require their
optional AWS peer packages to be available when importing the package. Follow
the [exporter installation guidance](../packages/aws-durable-execution-sdk-js-telemetry-exporter/README.md#installation)
for bundled or non-Lambda applications.

# @aws/durable-execution-sdk-js-telemetry-mcp 0.1.0-alpha.0

First release under the renamed Telemetry MCP package name. Use
`@aws/durable-execution-sdk-js-telemetry-mcp` and its `durable-telemetry-mcp`
command. The private telemetry-core workspace is bundled rather than required
from npm at runtime. The package remains a preview on `beta` and requires
Node.js 22.12.0 or later. See the [MCP package guide](../packages/aws-durable-execution-sdk-js-telemetry-mcp/README.md).
