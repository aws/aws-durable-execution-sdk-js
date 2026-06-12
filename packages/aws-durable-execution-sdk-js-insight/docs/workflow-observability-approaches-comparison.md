# Workflow Observability & Query Approaches: A Cross-Platform Analysis

## The Problem

You have a workflow-as-code platform running thousands (or millions) of workflow executions. You need to:

- **Find** specific executions (by status, time, name, custom criteria)
- **Inspect** what happened inside them (step-level details, timing, errors)
- **Act** on them (cancel, retry, restart failed ones)
- **Aggregate** across executions (how many failed? which steps are slow?)

Every platform must decide two things: **where** observability data lives and **who controls** the storage.

---

## Two Fundamental Strategies

### Strategy A: Built-In Store (Platform Owns the Data)

The workflow service stores observability data internally and provides APIs to query it. The platform decides the storage technology, schema, and query capabilities.

### Strategy B: External Data Sink (Developer Owns the Data)

The workflow service emits observability data to a developer-chosen external system (data lake, OLAP database, observability platform). The platform provides hooks/plugins for exporting; developers control storage, schema, indexing, and query tools.

```
Strategy A: Built-In                    Strategy B: External Sink
┌─────────────────────┐                ┌─────────────────────┐
│ Workflow Engine      │                │ Workflow Engine      │
│                      │                │                      │
│  ┌────────────────┐  │                │  emit/export ────────┼──► Developer's Data Lake
│  │ Internal Store  │  │                │  (plugin/hook/       │    (BigQuery, Snowflake,
│  │ (query via API) │  │                │   OpenTelemetry,     │     ClickHouse, S3,
│  └────────────────┘  │                │   webhook, CDC)      │     Elasticsearch, etc.)
└─────────────────────┘                └─────────────────────┘
```

---

## Strategy A: Built-In Store

The platform stores and queries observability data itself. This further splits into two sub-approaches based on whether the query store is the same as or separate from the engine store.

### A1: Single Store (Engine State = Query Store)

The same database that powers workflow execution also serves queries. No data replication, no separate visibility layer.

```
┌──────────────────────────────────┐
│         Single Database          │
│                                  │
│  Engine writes ──► State ◄── Query reads
│                                  │
└──────────────────────────────────┘
```

**Platforms using this approach:**

| Platform                    | Database                         | Access Method                  | Query Isolation   |
| --------------------------- | -------------------------------- | ------------------------------ | ----------------- |
| **Restate**                 | RocksDB (embedded, in-process)   | SQL via DataFusion             | ⚠️ Shared process |
| **DBOS**                    | Postgres (external)              | SDK (15+ filters) + direct SQL | ✅ Postgres MVCC  |
| **Cloudflare**              | Durable Objects/SQLite (managed) | REST API                       | ✅ Managed        |
| **AWS Lambda Durable**      | Managed (unknown internals)      | REST API                       | ✅ Managed        |
| **Azure Durable Functions** | Azure Storage/SQL (managed)      | REST API                       | ✅ Managed        |

**Pros:**

- ✅ Real-time data — no replication lag
- ✅ Automatic step-level data — engine already tracks steps for replay
- ✅ Lower operational overhead — one store (or zero if managed)
- ✅ Simpler architecture

**Cons:**

- ❌ Query impact risk — depends on implementation (embedded vs external vs managed)
- ❌ Query capabilities limited by engine's data model
- ❌ Scaling queries independently is harder
- ❌ Can't choose your own query tools

### A2: Separate Visibility Store (Dedicated Query Database)

The engine pushes denormalized records to a **separate database** at workflow lifecycle events. Queries hit this dedicated store, never the engine's primary storage.

```
┌──────────────┐     push       ┌──────────────────┐
│ Engine DB     │ ─────────────► │ Visibility Store  │
│ (primary)     │  at start/     │ (dedicated for    │
│               │  close/upsert  │  queries)         │
└──────────────┘                └────────┬─────────┘
                                         │ queries
                                         ▼
                                    Users / Tools
```

**Platforms using this approach:**

| Platform                   | Engine DB                  | Visibility DB                  | Query Language                         |
| -------------------------- | -------------------------- | ------------------------------ | -------------------------------------- |
| **Temporal (self-hosted)** | Cassandra/PostgreSQL/MySQL | Elasticsearch/PostgreSQL/MySQL | SQL-like with custom search attributes |
| **Temporal Cloud**         | Managed                    | Managed                        | Same SQL-like language                 |

**Pros:**

- ✅ Full query isolation — queries cannot affect execution
- ✅ Most powerful query capabilities — custom search attributes, complex boolean filters
- ✅ Bulk operations via query — cancel/terminate all matching a filter
- ✅ Independent scaling — scale visibility store separately

**Cons:**

- ❌ Eventually consistent — write lag between event and visibility update
- ❌ Higher operational overhead — two databases (self-hosted)
- ❌ No automatic step-level data — must manually instrument custom search attributes
- ❌ Data duplication

### Strategy A Summary

|                      | A1: Single Store          | A2: Separate Store       |
| -------------------- | ------------------------- | ------------------------ |
| **Data freshness**   | Real-time                 | Eventually consistent    |
| **Query isolation**  | Depends on implementation | Guaranteed               |
| **Step-level data**  | Automatic                 | Manual instrumentation   |
| **Operational cost** | Lower                     | Higher                   |
| **Query power**      | Limited to engine's model | Custom search attributes |
| **Bulk operations**  | Generally not supported   | Supported (Temporal)     |

---

## Strategy B: External Data Sink (Developer Owns the Data)

Instead of (or in addition to) querying the platform's built-in store, the workflow service emits execution data to an **external system chosen by the developer**. The developer controls the storage technology, schema, retention, indexing, and query tools.

```
┌─────────────────────┐
│ Workflow Engine      │
│                      │
│  Plugin / Hook ──────┼──► OpenTelemetry Collector ──► Jaeger / Datadog / Grafana
│                      │
│  CDC / WAL ──────────┼──► Kafka ──► ClickHouse / BigQuery / Snowflake
│                      │
│  Webhook ────────────┼──► Custom API ──► Any database
│                      │
│  Log Drain ──────────┼──► S3 / Elasticsearch / Splunk
│                      │
└─────────────────────┘
```

### Emission Mechanisms

| Mechanism                            | Description                                                                                | Platforms Supporting                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| **OpenTelemetry (traces/spans)**     | Standard observability protocol. Each step becomes a span with timing, status, attributes. | Restate (auto-generates OTel traces), DBOS (OTel integration), Temporal (interceptors) |
| **Webhook / Event hooks**            | Platform calls a URL on workflow lifecycle events (start, complete, fail).                 | Cloudflare (via Workers), DBOS (via Postgres triggers)                                 |
| **Change Data Capture (CDC)**        | Stream database changes to external systems.                                               | DBOS (Postgres CDC via Debezium/pg_logical), Temporal (visibility store CDC)           |
| **Log drains**                       | Export structured logs to external systems.                                                | Cloudflare (Workers log push), Vercel (log drains)                                     |
| **Custom interceptors / middleware** | SDK-level hooks that capture execution data and send it anywhere.                          | Temporal (interceptors), DBOS (custom steps)                                           |
| **Direct database access**           | Query the engine's database directly with external tools.                                  | DBOS (Postgres — connect Grafana, Metabase, etc.), Restate (SQL API)                   |
| **PL/pgSQL triggers**                | Database triggers that fire on workflow state changes.                                     | DBOS (Postgres triggers on `dbos.workflow_status`)                                     |

### What You Can Build With Strategy B

**Example: Workflow analytics in ClickHouse**

```
DBOS (Postgres) ──CDC──► Kafka ──► ClickHouse
                                        │
                                        ▼
                              Custom dashboard with:
                              • p50/p95/p99 step durations
                              • Failure rate by workflow type
                              • Step-level heatmaps
                              • Custom business metrics
```

**Example: Distributed tracing with Jaeger**

```
Restate ──OTel traces──► OTel Collector ──► Jaeger
                                               │
                                               ▼
                                    Trace visualization:
                                    • End-to-end latency
                                    • Step-by-step waterfall
                                    • Cross-service correlation
```

**Example: Alerting pipeline**

```
Temporal ──interceptor──► Custom webhook ──► PagerDuty
                                           ──► Slack
                                           ──► Custom alert rules
```

**Pros:**

- ✅ **Full control** — choose your own storage, schema, indexing, retention
- ✅ **Best query tools** — use ClickHouse, BigQuery, Grafana, Elasticsearch, or anything else
- ✅ **Unlimited custom attributes** — emit any data you want, no platform restrictions
- ✅ **Cross-system correlation** — join workflow data with application logs, metrics, business data
- ✅ **Independent scaling** — scale query infrastructure without touching the workflow engine
- ✅ **No vendor lock-in on query side** — switch query tools without changing workflow code
- ✅ **Aggregation and analytics** — build p50/p95/p99 dashboards, failure rate trends, etc.

**Cons:**

- ❌ **Requires building and maintaining a pipeline** — CDC, OTel collectors, data transforms
- ❌ **Eventually consistent** — data arrives in external store with some delay
- ❌ **No built-in lifecycle control** — can't cancel/terminate workflows from your data lake
- ❌ **Duplication of effort** — platform may already have built-in queries you're rebuilding
- ❌ **More moving parts** — collector, message queue, external database, dashboards
- ❌ **Cost** — external storage and query tools have their own costs

### Platform Support for Strategy B

| Platform               | OTel Traces         | CDC               | Direct DB Access   | Interceptors/Hooks   | Log Drains      |
| ---------------------- | ------------------- | ----------------- | ------------------ | -------------------- | --------------- |
| **Temporal**           | Via interceptors    | Via visibility DB | Visibility DB only | ✅ SDK interceptors  | ❌              |
| **Restate**            | ✅ Auto-generated   | ❌                | ✅ SQL API         | ❌                   | ❌              |
| **DBOS**               | ✅ OTel integration | ✅ Postgres CDC   | ✅ Direct Postgres | Via custom steps     | ❌              |
| **Cloudflare**         | ❌                  | ❌                | ❌                 | Via Workers bindings | ✅ Workers logs |
| **AWS Lambda Durable** | Via X-Ray/OTel      | ❌                | ❌                 | ❌                   | CloudWatch      |
| **Azure Durable**      | Via App Insights    | ❌                | ❌                 | ❌                   | App Insights    |

---

## Comparison Matrix

### Filtering Capabilities (Strategy A — Built-In)

| Capability                | Temporal | Restate | DBOS           | Cloudflare | AWS Lambda | Azure |
| ------------------------- | -------- | ------- | -------------- | ---------- | ---------- | ----- |
| Filter by status          | ✅       | ✅      | ✅             | ✅         | ✅         | ✅    |
| Filter by time range      | ✅       | ✅      | ✅             | ✅         | ✅         | ✅    |
| Filter by name/type       | ✅       | ✅      | ✅             | ❌         | ✅         | ❌    |
| Filter by ID prefix       | ✅       | ❌      | ✅             | ❌         | ❌         | ✅    |
| Custom search attributes  | ✅       | ❌      | ❌             | ❌         | ❌         | ❌    |
| SQL-like query language   | ✅       | ✅      | Via direct SQL | ❌         | ❌         | ❌    |
| Complex boolean filters   | ✅       | ✅      | Via direct SQL | ❌         | ❌         | ❌    |
| Cross-workflow queries    | ✅       | ✅      | ✅             | ❌         | ❌         | ❌    |
| Bulk operations via query | ✅       | ❌      | ❌             | ❌         | ❌         | ❌    |

### Step-Level Introspection (Without Custom Code)

| Data               | Temporal    | Restate               | DBOS                   | Cloudflare          | AWS Lambda | Azure       |
| ------------------ | ----------- | --------------------- | ---------------------- | ------------------- | ---------- | ----------- |
| Step names         | Via history | ✅ `sys_journal`      | ✅ `operation_outputs` | ✅ API              | ❌         | Via history |
| Step timing        | ❌          | ❌ (appended_at only) | ✅ (start + end)       | ✅ (start + end)    | ❌         | Via history |
| Per-attempt timing | ❌          | ❌                    | ❌                     | ✅ (unique!)        | ❌         | ❌          |
| Retry count        | ❌          | ✅                    | ❌                     | ✅ (attempts array) | ❌         | ❌          |
| Step output        | Via history | ❌                    | ✅                     | ✅                  | ❌         | Via history |
| Step errors        | Via history | ✅                    | ✅                     | ✅                  | ❌         | Via history |

### Operational Overhead

| Platform                   | Strategy             | Databases to manage | Self-hosted option |
| -------------------------- | -------------------- | ------------------- | ------------------ |
| **Temporal (self-hosted)** | A2 (separate store)  | 2                   | ✅                 |
| **Temporal Cloud**         | A2 (separate store)  | 0                   | ❌                 |
| **Restate**                | A1 (single/embedded) | 0                   | ✅                 |
| **DBOS**                   | A1 (single/external) | 1 (Postgres)        | ✅                 |
| **Cloudflare**             | A1 (single/managed)  | 0                   | ❌                 |
| **AWS Lambda Durable**     | A1 (single/managed)  | 0                   | ❌                 |
| **Azure Durable**          | A1 (single/managed)  | 0                   | ❌                 |

---

---

## Strategy C: Built-In Limited Store + External Data Sink (Hybrid)

The workflow service provides a **minimal built-in store** for basic operational queries (status, list, cancel) while also supporting **export to developer-chosen external systems** for advanced analytics, custom dashboards, and long-term retention.

```
┌─────────────────────────────────────────────────────────┐
│ Workflow Engine                                         │
│                                                         │
│  ┌──────────────────────┐                               │
│  │ Built-In Store       │  ◄── Basic queries:           │
│  │ (limited API)        │      status, list, cancel     │
│  └──────────────────────┘                               │
│                                                         │
│  Export hooks ───────────┼──► Developer's Data Lake      │
│  (OTel, CDC, webhooks)   │    ◄── Advanced queries:     │
│                          │        custom attributes,     │
│                          │        aggregations, joins,   │
│                          │        dashboards, alerting   │
└─────────────────────────────────────────────────────────┘
```

The platform intentionally keeps its built-in query capabilities **simple** (find by ID, filter by status/time, basic lifecycle control) and delegates advanced observability to external systems where developers have full control.

**How it differs from A + B:**

- Strategy A tries to be the **complete** query solution (Temporal's custom search attributes, Restate's full SQL)
- Strategy B is **purely external** — no built-in query at all
- Strategy C is **intentionally limited built-in + first-class export** — the platform acknowledges it shouldn't try to be a query engine

**What the built-in store handles (operational):**

- List/filter executions by status, time range, name
- Get individual execution details and step history
- Lifecycle control: cancel, pause, resume, terminate, restart
- Basic health: how many running, how many failed

**What the external sink handles (analytical):**

- Custom business-specific queries ("all orders over $1000 that failed at payment step")
- Aggregations and trends (p50/p95/p99 step durations over time)
- Cross-system correlation (join workflow data with app logs, metrics, traces)
- Alerting rules (PagerDuty/Slack on failure patterns)
- Long-term retention and compliance
- Custom dashboards in Grafana, Datadog, etc.

**Pros:**

- ✅ **Best of both worlds** — operational queries work out of the box, analytics use best-in-class tools
- ✅ **Platform stays simple** — no need to build Elasticsearch-level query capabilities into the engine
- ✅ **Developer control** — choose your own analytics stack without platform constraints
- ✅ **Independent scaling** — analytics infrastructure scales separately from workflow engine
- ✅ **No query isolation concerns** — heavy analytics queries hit external systems, not the engine
- ✅ **Future-proof** — swap analytics tools without changing workflow code

**Cons:**

- ❌ **Two systems to reason about** — "where do I query this?" depends on the question
- ❌ **Export pipeline to maintain** — OTel collectors, CDC, transforms
- ❌ **Gap between built-in and external** — some queries fall in between (too complex for built-in, too simple to justify a pipeline)
- ❌ **No platform does this perfectly today** — most lean toward A or B, not a deliberate hybrid

**Platforms closest to Strategy C today:**

| Platform               | Built-In (Operational)                       | Export (Analytical)            |
| ---------------------- | -------------------------------------------- | ------------------------------ |
| **DBOS**               | SDK filtering (15+ params) + direct SQL      | Postgres CDC, OTel integration |
| **Restate**            | SQL introspection API                        | Auto-generated OTel traces     |
| **Cloudflare**         | REST API (status/time filters, step details) | Workers log push               |
| **AWS Lambda Durable** | REST API (basic filters)                     | CloudWatch, X-Ray/OTel         |
| **Azure Durable**      | REST API (basic filters)                     | Application Insights           |

None of these were **designed** as Strategy C — they evolved into it. A platform purpose-built for Strategy C would have:

- Minimal but solid built-in API (list, filter, get, cancel)
- First-class OTel export with rich span attributes (step names, durations, custom data)
- Webhook/event hooks for lifecycle events
- Optional CDC or streaming export for raw data
- Clear documentation saying "use our API for operations, use your tools for analytics"

---

## Decision Guide

### Strategy A vs B vs C

| Question                               | A: Built-In Store                | B: External Sink Only       | C: Limited Built-In + External        |
| -------------------------------------- | -------------------------------- | --------------------------- | ------------------------------------- |
| "Find and cancel a specific workflow"  | ✅ Best fit                      | ❌ Can't act from data lake | ✅ Built-in handles this              |
| "p95 step duration dashboards"         | ❌ Most lack aggregation         | ✅ Best fit                 | ✅ External sink handles this         |
| "Correlate workflows with app metrics" | ❌ Siloed data                   | ✅ Best fit                 | ✅ External sink handles this         |
| "Zero setup"                           | ✅ Works out of the box          | ❌ Requires pipeline        | ⚠️ Built-in works, export needs setup |
| "Custom business queries"              | Limited (Temporal only)          | ✅ Full control             | ✅ External sink handles this         |
| "Alerting on failures"                 | Limited                          | ✅ Best fit                 | ✅ External sink handles this         |
| "Keep platform simple"                 | ❌ Platform becomes query engine | ✅ Platform stays focused   | ✅ Best fit — clear separation        |

### Recommendation

**Strategy C is likely the right answer for most teams.** Pure Strategy A forces the platform to become a query engine (complexity it shouldn't own). Pure Strategy B leaves you with no operational tools. Strategy C gives you operational basics out of the box and lets you bring your own analytics.

No platform is purpose-built for Strategy C today, but several are close. A platform designed for it would keep its built-in API deliberately simple and invest in first-class OTel/CDC/webhook export instead of trying to compete with Elasticsearch or ClickHouse.

### Within Strategy A: Single vs Separate Store

| Choose Single Store (A1) when              | Choose Separate Store (A2) when                          |
| ------------------------------------------ | -------------------------------------------------------- |
| You want automatic step-level data         | You need custom search attributes                        |
| You want real-time query results           | You need guaranteed query isolation                      |
| You want minimal operational overhead      | You need bulk operations via query                       |
| Your query patterns are simple to moderate | You need complex boolean queries across arbitrary fields |

### Best combinations by use case

| Use Case                            | Recommended                                        |
| ----------------------------------- | -------------------------------------------------- |
| **Small team, simple needs**        | A1 managed (Cloudflare/AWS/Azure)                  |
| **Need step-level debugging**       | A1 with DBOS or Cloudflare                         |
| **Enterprise with complex queries** | C: Temporal (built-in) + OTel → Grafana (external) |
| **Analytics and dashboards**        | C: Any A1 platform + CDC → ClickHouse/BigQuery     |
| **Self-hosted, zero ops**           | C: Restate (built-in SQL) + OTel traces (external) |
| **Cross-language workflows**        | C: DBOS (built-in Postgres) + CDC → analytics      |
