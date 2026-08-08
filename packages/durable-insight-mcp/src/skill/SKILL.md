---
name: durable-insight
description: Query AWS Lambda durable function execution history through the durable-insight MCP server — use when investigating workflow failures, execution timing, or step-level errors across DynamoDB, Athena/S3, Aurora, Redshift, OpenSearch, or CloudWatch Logs destinations.
---

# Durable Insight

The durable-insight MCP server gives you READ-ONLY access to the execution
history that AWS Lambda durable functions emit to a configured destination. Use
it to investigate failures, timing, and step-level errors. The destination is
chosen by the operator through `DURABLE_INSIGHT_*` environment variables; you do
not pick it and must not assume which one is in play.

## The one rule that makes this skill correct: ask the server for the schema

This skill deliberately contains ZERO destination-specific schema facts — no
field names, no column casing, no dialect syntax. That is not an omission; it is
the design:

- **Drift becomes impossible, not merely detectable.** Any schema prose copied
  here would silently rot the moment the server's schema changed. There is
  nothing to keep in sync because there is nothing duplicated.
- **Token economy.** One destination's guidance alone is over ten thousand
  characters. Inlining every destination's schema would load all of it on every
  invocation, whether or not you are on that destination.
- **Correctness.** Only the running server knows the configured destination. A
  static file would have to hedge across every backend and would be wrong for
  six of them at any given moment.

So: **call `describe_schema` before you write a `query`.** It returns the record
fields and query idioms for whatever destination is actually configured,
authoritatively. Writing a query without it is guessing.

## The five tools, and when to reach for each

- `test_destination` — Run first. Confirms the destination is reachable and its
  configuration is complete. If required environment variables are unset it
  names them and returns without any AWS call. Stop and report if it fails.
- `describe_schema` — Call before any `query`. Returns the configured
  destination's record schema, query engine/dialect, the table or log group in
  play, and the row cap. Makes no AWS call, so it is safe even before setup is
  complete.
- `list_executions` — The common case: list executions filtered by any of
  status, functionName, since, and until, with no SQL required. Prefer this over
  a hand-written `query` — it cannot be got wrong and costs fewer tokens.
- `get_execution` — Fetch a single execution record by its execution ARN. A
  record that does not exist is a success with found=false, not an error.
- `query` — Escape hatch for questions the structured tools cannot express. Only
  after `describe_schema`, so field names and syntax match the destination.

## Guarantees and limits you can rely on

- **Read-only.** For the SQL destinations, any statement that is not a
  SELECT/WITH is refused before any AWS call is made; the CloudWatch Logs query
  language has no write forms at all. You cannot mutate data through this server.
- **Row cap.** Every result is capped at a fixed maximum row count (MAX_ROWS,
  currently 1000). A truncated flag tells you when the cap was hit — narrow
  your filters rather than assuming you saw everything.
- **Log destinations need a lookback window.** CloudWatch Logs queries have no
  "all time"; pass a lookback window (hours) or accept the 24-hour default. This
  is ignored by the SQL destinations, which are not time-windowed.

## Suggested order for a failure investigation

1. `test_destination` — confirm reachability and configuration.
2. `describe_schema` — learn this destination's fields and idioms.
3. `list_executions` — narrow to the executions of interest (start with FAILED).
4. `get_execution` — drill into a specific record for step-level detail.
5. `query` — only when the structured tools cannot express the question.
