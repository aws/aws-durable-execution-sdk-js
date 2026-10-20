# How Each Platform Handles Operations & Observability

We reviewed 7 workflow-as-code platforms to understand how each approaches operations and observability — what data they store, how they expose it, what query capabilities they offer, and where the gaps are. For each platform, we examined the architecture (separate visibility store vs shared engine state vs managed API), the source code where available (Temporal in Go, Restate in Rust, DBOS in Python), and the public documentation. The sections below summarize each platform's approach in 4 paragraphs: architecture, query capabilities, lifecycle management, and gaps.

## Temporal

Temporal provides the most comprehensive operations story of any workflow-as-code platform, built around a dedicated Visibility Store that is architecturally separate from the execution engine. The engine explicitly pushes denormalized records to this store (Elasticsearch or SQL) at workflow lifecycle events — start, close, and upsert. This separation guarantees that heavy queries never impact workflow execution, at the cost of eventual consistency and operational overhead (two databases to manage for self-hosted deployments).

For querying, Temporal offers a SQL-like List Filter language with operators like `AND`, `OR`, `BETWEEN`, `IN`, and `STARTS_WITH` across 20+ default search attributes (WorkflowId, WorkflowType, ExecutionStatus, StartTime, TaskQueue, etc.). Engineers can also define custom search attributes (Bool, Int, Keyword, Text types) and upsert them from within workflow code, enabling queries like "find all payment workflows for customer X where amount > $1000." Bulk operations — cancel, terminate, signal, delete — can target all workflows matching a query filter.

Lifecycle management is handled through the CLI (`temporal workflow` commands), SDKs (Go, Java, TypeScript, Python, PHP, .NET), and a Web UI. Operations include start, cancel, terminate, pause, unpause, reset (to any point in history), signal, query (synchronous state inspection), and update (synchronous state mutation). The platform also tracks worker health, task queue depth, and provides SDK-level metrics (Prometheus/StatsD) for throughput and latency monitoring.

The main gap is that step-level data requires manual instrumentation. Temporal doesn't automatically track per-step duration or retry details in a queryable way — engineers must emit custom search attributes or use heartbeat payloads. OpenTelemetry integration exists via SDK interceptors with span links for async causality, but it requires explicit setup. Temporal Cloud eliminates the operational overhead of managing the Visibility Store but adds vendor lock-in.

---

## Restate

Restate takes a fundamentally different approach: its SQL introspection layer reads directly from the engine's live internal state in embedded RocksDB. There is no separate visibility store, no data replication, and no additional infrastructure. The `sys_invocation` and `sys_journal` tables expose the same data the Partition Processor uses for workflow execution — invocation status, step names, retry counts, error details, and journal entries are all queryable via SQL (powered by Apache DataFusion) without any custom instrumentation.

Operationally, Restate provides access through its CLI (`restate sql "SELECT ..."`), an HTTP query endpoint (`POST /query`), and a built-in UI. The SQL interface supports JOINs between `sys_invocation` and `sys_journal`, enabling queries like "find all invocations where step named 'payment' has retried more than 3 times." Lifecycle management includes cancel, kill, purge, and — since version 1.6 — pause, resume, and restart from any point in the journal. Restate also auto-generates OpenTelemetry traces for all handler interactions without any SDK configuration.

The trade-off is shared resources: queries and execution share the same RocksDB instance and process. Source code analysis confirms that `partition_store_scanner.rs` reads from the same `PartitionStore` the engine writes to, with no snapshot isolation layer between them. Simple filtered queries have minimal impact (RocksDB handles concurrent reads efficiently), but heavy table scans could theoretically compete for I/O with the workflow engine. There are no documented resource limits or query isolation guarantees.

Restate's main operational gaps are the absence of bulk operations via query (no "cancel all matching X"), no custom search attributes beyond what the engine tracks, and no step-level timestamps (only `appended_at` for journal entries, not start/end duration). For advanced analytics, teams must export data via the auto-generated OTel traces to external systems.

---

## DBOS

DBOS uses standard PostgreSQL as both its execution engine and query store — there is no separate server, no orchestration layer, just a library that checkpoints workflow state to Postgres tables. The `dbos.workflow_status` and `dbos.operation_outputs` tables store workflow-level and step-level data respectively, including `started_at_epoch_ms` and `completed_at_epoch_ms` for every step automatically. This means step duration is queryable out of the box without any custom instrumentation.

The SDK provides a rich `list_workflows` method with 15+ filter parameters: status, name, time range, queue, user, app version, parent workflow ID, forked-from, workflow ID prefix, executor ID, and more. Beyond the SDK, engineers can query the system tables directly with any Postgres client, BI tool, or Grafana dashboard — standard SQL with full JOIN, aggregation, and window function support. DBOS also provides PL/pgSQL functions (`dbos.enqueue_workflow`, `dbos.send_message`) for controlling workflows directly from SQL triggers or stored procedures.

Lifecycle management includes cancel, resume (from last completed step), fork (from any specific step — unique to DBOS), delete, and delay. The fork capability is particularly powerful for recovery: you can create a new workflow that reuses checkpoints up to a specific step, then re-executes from there with new code. Cross-language support (Python, TypeScript, Go, Java) sharing the same Postgres schema enables polyglot workflow management.

Query isolation relies on Postgres MVCC — reads don't block writes, and the SDK uses separate connection pools. For scaling queries independently, teams can use Postgres read replicas. The main gaps are no SQL-like query language in the SDK itself (filtering is via parameters, not free-form expressions), no custom search attributes beyond the built-in columns, and no built-in alerting (though the new Conductor product adds configurable alerting and dashboards).

---

## Cloudflare Workflows

Cloudflare Workflows provides public REST API. The `GET /instances/{id}` endpoint returns complete step details including per-attempt timing (start/end timestamps for every retry attempt), retry configuration (delay, limit, backoff strategy), step output, error details, and trigger source — all without any custom instrumentation. Step types are differentiated: `step` (business logic), `sleep` (timers), `waitForEvent` (external events), and `termination`.

The list endpoint (`GET /instances`) supports filtering by status (8 values: queued, running, paused, errored, terminated, complete, waitingForPause, waiting), date range, and cursor-based pagination. Lifecycle control is comprehensive: pause, resume, terminate, and restart are all available via `PATCH /instances/{id}/status`. The platform also supports batch instance creation and event delivery to running instances via REST. Instance retention is configurable per-instance with separate success and error retention durations.

Being fully managed on Cloudflare's edge infrastructure (Durable Objects with SQLite), there is zero operational overhead — no databases to deploy, no workers to scale, no storage to manage. Query isolation is handled by the platform. The Workers API provides SDK-level access (`env.WORKFLOW.create()`, `.get()`, `.pause()`, `.terminate()`, `.sendEvent()`) for programmatic control from within Cloudflare Workers.

The main limitations are in filtering: only status and date range are supported on the list endpoint (no filtering by workflow name, custom attributes, or step-level criteria). Cross-workflow queries are not possible — you must specify the workflow name. There are no bulk operations, no SQL-like query language, and no way to aggregate step-level metrics across instances via the API. For analytics, teams must iterate over instances individually or export data to external systems.

## Azure Durable Functions

Azure Durable Functions provides a REST API through the Durable Task Framework's HTTP endpoints, with filtering by runtime status (8+ values: Running, Completed, ContinuedAsNew, Failed, Canceled, Terminated, Pending, Suspended, Unknown), time range, and instance ID prefix. A unique feature is response content control: `showInput`, `showHistory`, and `showHistoryOutput` parameters let you choose how much detail to include in responses, from metadata-only to full execution history with step inputs and outputs.

Lifecycle management includes terminate, suspend, resume, and raise-event (for sending signals to waiting orchestrations). The platform integrates deeply with Application Insights for diagnostics — the Durable Extension automatically emits tracking events that trace end-to-end orchestration execution, queryable via Application Insights Analytics (Kusto queries). This provides a built-in path to external analytics without custom instrumentation.

Storage backends are configurable: Azure Storage (default), Microsoft Netherite (high-performance, based on FASTER), or MSSQL (for teams wanting SQL-based state). Each backend has different performance characteristics and operational trade-offs. The MSSQL backend enables direct SQL queries against orchestration state, similar to DBOS's approach.

The main gaps are no bulk operations via query, limited filtering on the list endpoint (no custom attributes, no step-level filtering), and no built-in alerting on orchestration health. Step-level data is available via the `showHistory` flag but only on individual instance queries, not for filtering across instances. For advanced observability, teams rely on Application Insights queries, which provide powerful analytics but require learning Kusto Query Language.

---

## Vercel Workflow

Vercel Workflow provides no documented public REST API for workflow management. The SDK exposes only `workflow.start()` and `workflow.getRun(runId)` — individual run queries by ID. There is no `listRuns()`, no filtering, no bulk operations, and no step-level data access via SDK. The dashboard provides visual filtering by environment, project, workflow name, step name, and status, but this uses private/internal APIs that are not documented for external use.

Operationally, Vercel Workflow is the most limited platform reviewed. You cannot programmatically list workflows, filter by criteria, cancel in bulk, or export execution data. The Observability Plus feature (Pro/Enterprise) adds a query builder for custom analytics, but this is dashboard-only — no programmatic access. For any automation, monitoring integration, or custom tooling, teams must build their own tracking system on top of the SDK's basic `getRun()` method.

The platform is fully managed with zero operational overhead, and the dashboard filtering is reportedly comprehensive for manual investigation. But the complete absence of programmatic observability access makes it unsuitable for teams that need automated monitoring, alerting pipelines, or integration with existing observability tools (Datadog, Grafana, PagerDuty).

For teams on Vercel's ecosystem who only need occasional manual inspection via the dashboard, this may be acceptable. For any production system requiring automated operations — stuck workflow detection, SLA alerting, bulk recovery, or analytics — Vercel Workflow requires building an entirely custom observability layer.
