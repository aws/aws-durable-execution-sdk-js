# Operation shape: canonical array + per-store `operationsByName` index

> Status: **implemented.** `operations` stays a canonical array; the
> `LambdaLogExporter`, `CloudWatchLogsExporter`, and `DynamoDBExporter` emit a
> derived `operationsByName` index via `buildOperationsByName`.

## Decision

`WorkflowInsightRecord.operations` stays a **canonical JSON array** of
`OperationRecord`. It is the lossless source of truth. Exporters that target
point-access stores additionally emit a derived, name-keyed **`operationsByName`**
index; array-native stores keep only the array.

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
  filter "the array element named X" well. These additionally emit
  `operationsByName` for dot-path queries. They emit **array + `operationsByName`**.
- **Array-native stores** — `S3Exporter` (Athena), `OpenSearchExporter`
  (`nested`), `AuroraExporter`, `RedshiftExporter` (SUPER) — keep the **array only**.
- **Custom exporters** may reshape however they want.

## `operationsByName` specification

- Keyed by the **raw operation name**. Unnamed operations are excluded (a
  customer can't identify or query them anyway).
  - Caveat: names containing `.` (or other path-breaking characters) don't work
    as dot-path keys in CloudWatch/OpenSearch/DynamoDB. No sanitization is done;
    the canonical array is the fallback. Recommend avoiding `.` in step names.
- Value = a per-name summary combining two kinds of fields:
  - **Aggregated across ALL occurrences** (multiplicity-independent, safe for
    filtering): `count`, `minDurationMs`, `maxDurationMs`, `totalDurationMs`,
    `failedCount`, `maxAttempt`.
  - **Snapshot of the LAST occurrence** (by `startTime`; fallback insertion
    order): `type`, `subType`, `status`, and `result` **XOR** `error`.
    - A single occurrence is either a success (has `result`) or a failure (has
      `error`), so the last occurrence naturally contributes one of them.
    - `result` is present only when the operation opted in via
      `content.operations.overrides[].result`. `error` is gated by
      `content.operations.includeErrors`.
    - **SerDes caveat** applies to `result`: it is the checkpointed, serialized
      (and override-transformed) value — with a custom/overflow Serdes it may be
      a non-JSON string or a storage pointer, not the original object.

Rule of thumb: **aggregate metrics across all runs; snapshot the last run's
`type`/`subType`/`status`/`result`/`error`.**

### Example value

```json
"operationsByName": {
  "convert_data": {
    "type": "STEP",
    "subType": "Step",
    "count": 2,
    "minDurationMs": 4200,
    "maxDurationMs": 8100,
    "totalDurationMs": 12300,
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
    "status": "FAILED",
    "error": { "name": "StepError", "message": "declined" }
  }
}
```

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
- Representative detail: **last** occurrence (by `startTime`, insertion-order tiebreak).
- `operationsByName` is emitted **always** by the three point-access exporters
  (no toggle) — bounded by distinct names, so the size cost is small.

## Implementation plan

1. Shared, unit-tested `buildOperationsByName(operations)` helper.
2. Wire it into `LambdaLogExporter`, `CloudWatchLogsExporter`, `DynamoDBExporter`
   (emit array + `operationsByName`).
3. Leave array-native exporters unchanged.
4. Document the per-store shape and example queries in the README.
