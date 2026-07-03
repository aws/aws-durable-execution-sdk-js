# Workflow Insight Plugin — Remaining Tasks

> Status legend: `[x]` done · `[~]` partially done · `[ ]` not started.
> Scope source of truth: `plugin-contracts.md` (config, record shape, emit timing)
> and `milestones.md` (POC scope).

## Record Building

- [x] Build the full `WorkflowInsightRecord` (identity fields: executionArn, functionName, region, accountId, etc.)
- [x] Parse executionArn to extract functionName, qualifier, region, accountId
- [x] Track execution status (map `PluginInvocationStatus` → RUNNING/SUCCEEDED/FAILED/PENDING)
- [x] Capture execution input from `InvocationEndInfo.executionInput`
- [x] Capture execution output from `InvocationEndInfo.executionResult`
- [x] Capture execution error from `InvocationEndInfo.executionError`
- [x] Compute execution `startTime` and `endTime`/`durationMs`
- [x] Handle non-Date operation timestamps (runtime sends epoch ms numbers, not Date objects)

## Operation-Level Detail Capture

> The `OperationRecord` contract includes `attempt`, per-operation `error`, and
> `result`. These are all present in the checkpointed `Operation` data; the core
> SDK's `toOperationInfo()` now surfaces them on `OperationInfo`, so they arrive
> via `onOperationChange` with no extra lifecycle hooks needed.

- [x] Capture per-operation `error` — SDK `toOperationInfo` maps `*Details.Error`
      onto `OperationInfo.error` (via `DurableOperationError.fromErrorObject`);
      plugin serializes it into `OperationRecord.error`.
- [x] Capture per-operation `attempt` count — SDK maps `StepDetails.Attempt`
      onto `OperationInfo.attempt`; plugin serializes it into `OperationRecord.attempt`.
- [x] Capture per-operation `result` — `OperationInfo.result` (mapped by the SDK)
      is now serialized into `OperationRecord.result`, gated behind a matching
      `content.operations.overrides[].result` transform (omitted by default to
      avoid unbounded payloads).

## Query Ergonomics — per-store operation shaping

> Design agreed in `operations-shape.md`. `operations` stays a canonical array;
> point-access stores emit a name-keyed `operationsByName` index instead of the array.

- [x] Add shared `buildOperationsByName(operations)` helper (per-name summary:
      aggregate `count`/`min`/`max`/`totalDurationMs`/`failedCount`/`maxAttempt`
      across occurrences + last-occurrence `type`/`subType`/`status`/`result`|`error`)
- [x] Emit `operationsByName` (instead of the array) from `LambdaLogExporter`,
      `CloudWatchLogsExporter`, and `DynamoDBExporter`
- [x] Unit tests for `buildOperationsByName` (duplicate names, last-occurrence
      result/error, failedCount, missing durations)
- [x] Document per-store shape + example queries in the README
- [x] `operationsFormat` option (`array` | `by-name` | `both`, default `array`) on the
      flexible-sink exporters — `HttpExporter`, `OTelExporter`, `SQSExporter`,
      `EventBridgeExporter`, `FirehoseExporter`, `FileExporter`. (Timestream is
      dimensional, so it's excluded.)

## Content Filtering

- [x] Apply `content.input` transform (boolean or function)
- [x] Apply `content.output` transform (boolean or function)
- [x] Apply `content.operations.overrides` — exclude operations and transform results
- [x] Apply `content.operations.includeErrors` setting

## Sampling

- [x] Implement sampling decision (skip all work if not sampled) — all-or-nothing
      per execution; sampled-out executions schedule no records and make no
      exporter calls (guarded in every hook + drain/flush skipped in `wrapInvocation`).
- [x] Make the sampling decision **deterministic across replays** — keyed on the
      execution ARN, which is stable across replays, hashed with FNV-1a via
      `Math.imul` for a cross-engine-stable 32-bit result. Out-of-range/non-numeric
      rates are clamped/defaulted with a warning.

## Emit Timing & Lifecycle

- [x] Export on `onInvocationEnd`
- [x] Export on `onOperationChange` for `on-change` mode (gated by `emitMode`)
- [x] Flush/await before returning via `wrapInvocation`
- [x] Handle exporter errors gracefully (never fail the execution; `Promise.allSettled`)
- [x] Coalesce overlapping exports — single in-flight export + latest-pending slot,
      so intermediate in-progress updates are dropped (`ExportScheduler`)
- [x] Drain the export queue in `wrapInvocation` so the final record is delivered
- [x] In `on-complete` mode, emit **only** on terminal `SUCCEEDED`/`FAILED`
      (also added `on-failure` mode: emit only on terminal `FAILED`). Gated in
      `onInvocationEnd`; non-terminal `PENDING`/`RETRYING` updates no longer emit.

## Record Size / Truncation

- [x] Enforce `maxRecordSizeBytes` per exporter — applied per-exporter in
      `ExportScheduler` via `truncateRecord`; each first-party exporter sets a
      destination-appropriate default (CW/Lambda-log/SQS/EventBridge 256KB,
      DynamoDB 400KB, Aurora/Redshift/Firehose/OTel 1MB, S3 5MB, OpenSearch 10MB;
      HTTP/File/Timestream none). `undefined` disables truncation.
- [x] Truncate oversized records by dropping operation results oldest-first, then
      whole operations oldest-first, then — as a last resort — execution input
      then output; identity/timeline fields are never dropped. Sets record-level
      `truncated`, a per-operation `truncated` flag on operations whose result was
      dropped, the `droppedOperations` count, and `droppedInput`/`droppedOutput`
      flags (additive fields — schemaVersion stays "1.0"). Never mutates the
      shared record (each exporter gets its own trimmed copy).

## Exporters (first-party)

- [x] `LambdaLogExporter` — stdout → function's own CloudWatch log group (zero IAM)
- [x] `CloudWatchLogsExporter` — PutLogEvents to any log group, date-partitioned streams
- [x] `S3Exporter` — PutObject with Hive partitioning, upsert by execution key
- [x] `DynamoDBExporter` — PutItem, upsert or history via sort key
- [x] `AuroraExporter` — RDS Data API (MySQL + PostgreSQL), SQL upsert
- [x] `RedshiftExporter` — Redshift Data API, MERGE upsert
- [x] `OpenSearchExporter` — Index API with SigV4/basic auth, upsert by \_id
- [x] `FirehoseExporter` — PutRecord as NDJSON to Kinesis Firehose
- [x] `EventBridgeExporter` — PutEvents for event-driven reactions
- [x] `SQSExporter` — SendMessage with FIFO/dedup support
- [x] `TimestreamExporter` — WriteRecords as multi-measure time-series
- [x] `OTelExporter` — OTLP HTTP/JSON to any compatible backend
- [x] `HttpExporter` — generic POST/PUT to any URL
- [x] `FileExporter` — filesystem (EFS, S3 mount, /tmp) in ndjson or json mode

## Testing

> Jest is set up for the package (`jest.config.js` + `npm test`), mirroring the
> core SDK's ts-jest configuration. Tests drive the public `workflowInsight`
> plugin via a capturing exporter.

- [x] Unit tests for `toOperationRecord` and `buildOperationRecords` — covered via
      content-filtering + operation-detail tests (exclude, includeErrors, result gating,
      error/attempt capture, unnamed-op exclusion)
- [~] Unit tests for record building (full WorkflowInsightRecord) — status mapping
  (PENDING→RUNNING) and emit modes covered; identity-field building not yet
- [ ] Unit tests for `ExportScheduler` (coalescing, no overlap, drain)
- [x] Unit tests for content filtering (input/output transforms, operation overrides,
      includeErrors, result transform incl. non-JSON + throwing-transform safety)
- [x] Unit tests for record truncation — drop order (results then whole
      operations, oldest-first), `truncated`/dropped counts, no-op when it fits,
      no input mutation, input/output never dropped, and per-exporter application
      via the scheduler (different limits → different copies).
- [x] Unit tests for sampling logic (including replay determinism) — covers
      rate 0 / 1 / omitted, fractional partitioning, invocationId-independence
      (replay stability), stable re-runs, and out-of-range/NaN clamping.
- [ ] Unit tests for each exporter (mock SDK clients, verify correct API calls)
- [ ] Integration test with the testing SDK (end-to-end plugin lifecycle)
- [x] Verified end-to-end on deployed Lambda (account 730758745077, `insight-demo-scheduled`)

## Packaging & Docs

- [x] `npm run build` passes locally (esm, cjs, types)
- [x] Add the insight package to root `package.json` build/test scripts
- [x] Wire the package into ESLint — added a package-local `eslint.config.js`
      (core SDK's TypeScript rules, using only published deps — no local
      filename-convention plugin) and a `lint` script, consistent with the other
      packages. Lints clean (0 errors); pre-commit lint-staged now applies the
      TS rules to insight sources.
- [x] Package `README.md` — comprehensive docs with all exporters, config, examples
- [ ] Add a runnable example under `aws-durable-execution-sdk-js-examples`

## VS Code Extension (companion package)

- [x] First revision: CloudWatch Logs Insights + Bedrock NL→query
- [x] Settings UI (in-panel gear button)
- [x] Auto-run (generate + run in one click)
- [x] Time range inferred from question by Bedrock
- [x] Self-correction loop (retry with error feedback on MalformedQueryException)
- [x] TESTING.md step-by-step guide
- [ ] Support additional query providers (S3/Athena, DynamoDB)
- [ ] Model provider abstraction (local LLM option)
- [ ] Query history and saved queries
- [ ] CSV export

## Known Limitations (document, not necessarily fix)

- [x] Documented in README: best-effort delivery only
- [x] Operation `result` (via `content.operations.overrides[].result`) exposes the
      **checkpointed serialized** value, not the deserialized object. The plugin
      does not run the SDK `Serdes.deserialize`; with a custom/overflow Serdes the
      transform may receive a non-JSON string or a storage pointer. Documented in
      README (content caveat), `OperationOverride.result` JSDoc, and plugin-contracts.
- [ ] Document no coverage for backend-initiated events (`STOPPED`, `TIMED_OUT`);
      customers must subscribe to EventBridge lifecycle events themselves
- [ ] `RedshiftExporter` stores time fields as `VARCHAR(30)` — needs `::timestamptz`
      casts in the MERGE SQL (same fix applied to AuroraExporter). Fix when adding
      Redshift to the VS Code extension query providers.
