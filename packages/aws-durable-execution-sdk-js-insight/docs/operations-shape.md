# Operation shape: canonical array + per-store `operationsByName` index

> Status: **implemented.** `operations` stays a canonical array; the
> `LambdaLogExporter`, `CloudWatchLogsExporter`, and `DynamoDBExporter` emit a
> derived `operationsByName` index via `buildOperationsByName`.

## Decision

`WorkflowInsightRecord.operations` stays a **canonical JSON array** of
`OperationRecord`. It is the lossless source of truth. Exporters that target
point-access stores emit a derived, name-keyed **`operationsByName`** index
instead of the array; array-native stores keep the array.

**Unnamed operations are excluded everywhere.** An operation with no `name` is
dropped from the canonical array (current behavior) and, consequently, from the
`operationsByName` index — a customer can't identify or query an operation they
never named, so surfacing it adds noise without value.

## Why the array is canonical

- **Duplicate operation names are legitimate.** The same step name runs many
  times via loops, retries, and `map`/`parallel` (e.g. the agentic-loop pattern
  reuses `context.step("invoke-model", …)` every iteration). A flat
  `name → object` map silently collapses these (last-wins) and loses data.
- **It queries well in every real query engine.** See examples below —
  Athena, Postgres, MySQL, Redshift, and OpenSearch all filter array-of-object
  data natively (via `UNNEST`, JSONPath, SUPER, or `nested`).
- **Dynamic keys break schema stores.** Keying by arbitrary operation names
  causes OpenSearch mapping/field explosion and an unstable Athena schema. The
  array keeps one stable structure regardless of operation names.
- **Lossless superset → exporters specialize.** Reshaping an array into a
  name-keyed map is trivial inside an exporter; the reverse (map → array) is
  impossible once duplicates were collapsed. So the canonical model is the
  array, and per-store shaping lives at the edge.

## Per-store shaping (in exporters)

- **CloudWatch Logs Insights** (`LambdaLogExporter`, `CloudWatchLogsExporter`)
  and **DynamoDB** (`DynamoDBExporter`) are point-access stores that cannot
  filter "the array element named X" well. These emit **`operationsByName`
  instead of the `operations` array** — the map is dot-path queryable. (Trade-off:
  these stores no longer carry the per-occurrence array detail.)
- **Array-native stores** — `S3Exporter` (Athena), `OpenSearchExporter`
  (`nested`), `AuroraExporter`, `RedshiftExporter` (SUPER) — keep the
  **`operations` array** (no `operationsByName`).
- **Custom exporters** may reshape however they want.

- **Flexible sinks** — `HttpExporter` and `OTelExporter` target arbitrary,
  user-defined consumers, so they take an `operationsFormat` option:
  `"array"` (default, lossless) · `"by-name"` · `"both"`. Defaulting to `"array"`
  keeps the safe, dynamic-key-free shape; users who know their consumer can opt
  into the map. (`"both"` is allowed here because these sinks have no
  store-shape constraint.)

Each store therefore carries exactly one operations representation: the array,
or the `operationsByName` map — never both.

## `operationsByName` specification

- Keyed by the **raw operation name**. Unnamed operations are excluded (a
  customer can't identify or query them anyway).
  - Caveat: names containing `.` (or other path-breaking characters) don't work
    as dot-path keys in CloudWatch/OpenSearch/DynamoDB. No sanitization is done;
    the canonical array is the fallback. Recommend avoiding `.` in step names.
- Value = a per-name summary, built in a **single pass** over the array
  (insert-or-update; no grouping or sorting):
  - **Aggregated across ALL occurrences** (multiplicity-independent, safe for
    filtering): `count`, `minDurationMs`, `maxDurationMs`, `totalDurationMs`,
    `failedCount`, `maxAttempt`.
  - **Most recently seen occurrence**: `type`, `subType`, `status` (the runtime
    appends newer operations to the end of the array, so the last one processed
    wins).
  - **`result` / `error`** are included only when the name occurs **exactly
    once** in the execution. On the first repeat they are dropped — a repeated
    name has no single representative value, and this keeps the logic trivial (no
    "which occurrence?" choice).
    - `result` is present only when the operation opted in via
      `content.operations.overrides[].result`. `error` is gated by
      `content.operations.includeErrors`.
    - **SerDes caveat** applies to `result`: it is the checkpointed, serialized
      (and override-transformed) value — with a custom/overflow Serdes it may be
      a non-JSON string or a storage pointer, not the original object.

Rule of thumb: **aggregate metrics across all runs; keep `result`/`error` only
for names that ran once.**

### Example value

```json
"operationsByName": {
  "insert_to_db": {
    "type": "STEP",
    "subType": "Step",
    "count": 1,
    "minDurationMs": 6200,
    "maxDurationMs": 6200,
    "totalDurationMs": 6200,
    "failedCount": 0,
    "maxAttempt": 1,
    "status": "SUCCEEDED",
    "result": { "rows": 1200 }
  },
  "charge": {
    "type": "STEP",
    "subType": "Step",
    "count": 3,
    "minDurationMs": 90,
    "maxDurationMs": 210,
    "totalDurationMs": 450,
    "failedCount": 1,
    "maxAttempt": 3,
    "status": "SUCCEEDED"
  }
}
```

`insert_to_db` ran once → its `result` is kept. `charge` ran three times → no
single `result`/`error`, just the aggregate metrics (`failedCount: 1` still flags
that one run failed).

## Query example: "executions where operation `convert_data` took < 5s"

**Array-native stores** (query the canonical array):

```sql
-- Athena (Trino)
SELECT execution_arn FROM workflow_insight
WHERE any_match(operations, op -> op.name = 'convert_data' AND op.durationMs < 5000);

-- Postgres (JSONB), GIN-indexable
WHERE record_json @? '$.operations[*] ? (@.name == "convert_data" && @.durationMs < 5000)';

-- Redshift (SUPER)
SELECT DISTINCT w.execution_arn FROM workflow_insight w, w.record_json.operations op
WHERE op.name::varchar = 'convert_data' AND op.durationMs::int < 5000;
```

```json
// OpenSearch (nested)
{
  "query": {
    "nested": {
      "path": "operations",
      "query": {
        "bool": {
          "must": [
            { "term": { "operations.name": "convert_data" } },
            { "range": { "operations.durationMs": { "lt": 5000 } } }
          ]
        }
      }
    }
  }
}
```

**Point-access stores** (query `operationsByName`):

```
# CloudWatch Logs Insights
fields executionArn | filter operationsByName.convert_data.maxDurationMs < 5000

# DynamoDB (FilterExpression — expressible, still a Scan)
operationsByName.convert_data.maxDurationMs < :v   (:v = 5000)
```

(`maxDurationMs < 5000` = every run under 5s; `minDurationMs < 5000` = at least one run under 5s.)

## Decisions (resolved)

- `totalDurationMs`: **included** (enables cumulative-cost queries `min`/`max` don't).
- `subType`: **included** (carries customer-defined child-context labels).
- Representative detail: `result`/`error` kept only for **single-occurrence**
  names (dropped on the first repeat); `type`/`subType`/`status` reflect the
  most recently seen occurrence. Single-pass, no sorting.
- `operationsByName` is emitted **always** by the three point-access exporters
  (no toggle) — bounded by distinct names, so the size cost is small.

## Implementation plan

1. Shared, unit-tested `buildOperationsByName(operations)` helper.
2. Wire it into `LambdaLogExporter`, `CloudWatchLogsExporter`, `DynamoDBExporter`
   (emit `operationsByName` instead of the `operations` array).
3. Leave array-native exporters unchanged.
4. Document the per-store shape and example queries in the README.
