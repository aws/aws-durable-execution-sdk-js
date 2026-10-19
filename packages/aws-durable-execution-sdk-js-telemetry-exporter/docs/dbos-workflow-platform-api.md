# DBOS Workflow Platform - API & Query Capabilities

## Overview

DBOS is an open-source durable execution library (Python, TypeScript, Go, Java) that uses **Postgres as its only dependency**. There is no orchestration server — DBOS is a library you install into your application. Workflow state is checkpointed directly to Postgres system tables, which also serve as the query/observability layer. This means the engine tables and the query tables are **the same tables**.

## Architecture

```
┌─────────────────────────────────────────────────┐
│           Your Application Process              │
│                                                 │
│   ┌───────────────────────────────────────┐     │
│   │ DBOS Library (no separate server)     │     │
│   │ • Workflow orchestration              │     │
│   │ • Step checkpointing                  │     │
│   │ • Recovery on restart                 │     │
│   └──────────────┬────────────────────────┘     │
│                  │ SQLAlchemy                    │
│                  ▼                               │
│   ┌───────────────────────────────────────┐     │
│   │ PostgreSQL (single database)          │     │
│   │ dbos.workflow_status  ← engine writes │     │
│   │ dbos.operation_outputs← engine writes │     │
│   │ dbos.notifications                    │     │
│   │ dbos.workflow_events                  │     │
│   │ dbos.streams                          │     │
│   │ dbos.workflow_schedules               │     │
│   │                                       │     │
│   │ Same tables for:                      │     │
│   │ • Engine checkpointing (writes)       │     │
│   │ • SDK queries (reads)                 │     │
│   │ • Direct SQL queries (reads)          │     │
│   │ • PL/pgSQL functions (writes)         │     │
│   └───────────────────────────────────────┘     │
└─────────────────────────────────────────────────┘
```

**Key architectural properties:**

- **No orchestration server** — just a library + Postgres
- **No separate visibility store** — engine tables ARE the query tables
- **Postgres is the only dependency** (SQLite for dev/testing)
- **Multi-language** — Python, TypeScript, Go, Java all share the same Postgres schema
- **Direct SQL access** — you can query system tables with any Postgres client

## Database / Storage Technology

- **Production**: PostgreSQL
- **Development**: SQLite (zero config)
- **ORM**: SQLAlchemy (Python), Knex (TypeScript)

## Execution Status Values (7)

| Status                           | Description                                |
| -------------------------------- | ------------------------------------------ |
| `PENDING`                        | Currently executing                        |
| `SUCCESS`                        | Completed successfully                     |
| `ERROR`                          | Failed with error                          |
| `ENQUEUED`                       | Waiting in a durable queue                 |
| `DELAYED`                        | Enqueued but delayed until a specific time |
| `CANCELLED`                      | Manually cancelled                         |
| `MAX_RECOVERY_ATTEMPTS_EXCEEDED` | Exceeded retry limit                       |

## System Tables

### `dbos.workflow_status` — Workflow-Level State

| Column                       | Type   | Description                            |
| ---------------------------- | ------ | -------------------------------------- |
| `workflow_uuid`              | TEXT   | Unique workflow ID                     |
| `status`                     | TEXT   | Execution status                       |
| `name`                       | TEXT   | Fully qualified workflow function name |
| `inputs`                     | TEXT   | Serialized workflow inputs             |
| `output`                     | TEXT   | Serialized workflow output             |
| `error`                      | TEXT   | Serialized error                       |
| `created_at`                 | BIGINT | Creation timestamp (epoch ms)          |
| `updated_at`                 | BIGINT | Last update timestamp (epoch ms)       |
| `started_at_epoch_ms`        | BIGINT | When dequeued and started              |
| `queue_name`                 | TEXT   | Queue name (if enqueued)               |
| `executor_id`                | TEXT   | ID of executor that ran this           |
| `application_version`        | TEXT   | App version                            |
| `parent_workflow_id`         | TEXT   | Parent workflow ID (if child)          |
| `forked_from`                | TEXT   | Original workflow ID (if forked)       |
| `was_forked_from`            | BOOL   | Whether this has been forked           |
| `authenticated_user`         | TEXT   | User who ran the workflow              |
| `recovery_attempts`          | INT    | Number of recovery attempts            |
| `priority`                   | INT    | Queue priority                         |
| `deduplication_id`           | TEXT   | Deduplication key                      |
| `workflow_timeout_ms`        | BIGINT | Timeout duration                       |
| `workflow_deadline_epoch_ms` | BIGINT | Absolute deadline                      |

### `dbos.operation_outputs` — Step-Level State

| Column                  | Type   | Description                            |
| ----------------------- | ------ | -------------------------------------- |
| `workflow_uuid`         | TEXT   | Parent workflow ID                     |
| `function_id`           | INT    | Step index within workflow             |
| `function_name`         | TEXT   | Step function name                     |
| `output`                | TEXT   | Serialized step output                 |
| `error`                 | TEXT   | Serialized step error                  |
| `child_workflow_id`     | TEXT   | Child workflow ID (if step starts one) |
| `started_at_epoch_ms`   | BIGINT | When step started                      |
| `completed_at_epoch_ms` | BIGINT | When step completed                    |

### Other Tables

- **`dbos.notifications`** — Workflow messages (topic, message, consumed)
- **`dbos.workflow_events`** — Workflow events (key/value pairs)
- **`dbos.workflow_events_history`** — Historical event changes per step
- **`dbos.streams`** — Workflow stream messages
- **`dbos.workflow_schedules`** — Cron/scheduled workflow definitions
- **`dbos.application_versions`** — Registered app versions

## SDK Query API (`list_workflows`)

DBOS provides a rich `list_workflows` method with **15+ filter parameters**:

```python
workflows = DBOS.list_workflows(
    status="ERROR",                          # Filter by status
    name="my_module.process_order",          # Filter by workflow name
    start_time="2024-01-01T00:00:00Z",       # Started after
    end_time="2024-01-31T23:59:59Z",         # Started before
    queue_name="high-priority",              # Filter by queue
    user="admin",                            # Filter by authenticated user
    app_version="v2.1",                      # Filter by app version
    parent_workflow_id="parent-123",         # Filter by parent
    forked_from="original-456",              # Filter by fork source
    workflow_id_prefix="order-",             # Prefix match on ID
    executor_id="executor-1",               # Filter by executor
    has_parent=True,                         # Only child workflows
    was_forked_from=False,                   # Only non-forked workflows
    limit=100,                               # Pagination
    offset=0,                                # Pagination offset
    sort_desc=True,                          # Sort order
    load_input=False,                        # Skip deserializing inputs
    load_output=False,                       # Skip deserializing outputs
)
```

### Step-Level Queries

```python
steps = DBOS.list_workflow_steps("workflow-123")
for step in steps:
    print(f"Step {step['function_id']}: {step['function_name']}")
    print(f"  Started: {step['started_at_epoch_ms']}")
    print(f"  Completed: {step['completed_at_epoch_ms']}")
    duration = step['completed_at_epoch_ms'] - step['started_at_epoch_ms']
    print(f"  Duration: {duration}ms")
```

### Direct SQL Access

Since system tables are standard Postgres tables, you can query them directly:

```sql
-- Find all failed workflows in the last 24 hours
SELECT workflow_uuid, name, error, created_at
FROM dbos.workflow_status
WHERE status = 'ERROR'
  AND created_at > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours') * 1000
ORDER BY created_at DESC;

-- Find slow steps (> 10 seconds)
SELECT o.workflow_uuid, o.function_name,
       o.completed_at_epoch_ms - o.started_at_epoch_ms AS duration_ms
FROM dbos.operation_outputs o
WHERE o.completed_at_epoch_ms - o.started_at_epoch_ms > 10000
ORDER BY duration_ms DESC;

-- Join workflows with their steps
SELECT w.workflow_uuid, w.name, w.status,
       o.function_name, o.started_at_epoch_ms, o.completed_at_epoch_ms
FROM dbos.workflow_status w
JOIN dbos.operation_outputs o ON w.workflow_uuid = o.workflow_uuid
WHERE w.status = 'ERROR'
ORDER BY w.created_at DESC;

-- Enqueue a workflow directly from SQL
SELECT dbos.enqueue_workflow('process_order', 'order-queue',
    ARRAY['{"order_id": "123"}'::JSON]);
```

## Workflow Management API

| Method                         | Description                           |
| ------------------------------ | ------------------------------------- |
| `DBOS.list_workflows()`        | List/filter workflows (15+ params)    |
| `DBOS.list_workflow_steps()`   | List steps with timing data           |
| `DBOS.list_queued_workflows()` | List currently enqueued workflows     |
| `DBOS.get_workflow_status()`   | Get single workflow status            |
| `DBOS.cancel_workflow()`       | Cancel a workflow                     |
| `DBOS.cancel_workflows()`      | Bulk cancel                           |
| `DBOS.resume_workflow()`       | Resume from last completed step       |
| `DBOS.resume_workflows()`      | Bulk resume                           |
| `DBOS.fork_workflow()`         | Fork from a specific step             |
| `DBOS.delete_workflow()`       | Delete workflow + all data            |
| `DBOS.delete_workflows()`      | Bulk delete                           |
| `DBOS.set_workflow_delay()`    | Set/update delay on DELAYED workflows |
| `DBOS.get_result()`            | Wait for and get workflow result      |
| `DBOS.retrieve_workflow()`     | Get workflow handle                   |

### CLI Commands

```bash
dbos workflow list                    # List workflows
dbos workflow list --status ERROR     # Filter by status
dbos workflow steps <workflow_id>     # List steps
dbos workflow cancel <workflow_id>    # Cancel
dbos workflow resume <workflow_id>    # Resume
dbos workflow queue list              # List enqueued workflows
```

## PL/pgSQL Functions (SQL-Native Workflow Control)

DBOS provides Postgres functions for controlling workflows directly from SQL:

```sql
-- Enqueue a workflow from a trigger or stored procedure
SELECT dbos.enqueue_workflow(
    'process_order',           -- workflow name
    'order-queue',             -- queue name
    ARRAY['{"id": "123"}'::JSON]  -- arguments
);

-- Send a message to a running workflow
SELECT dbos.send_message(
    'workflow-uuid-123',       -- destination workflow ID
    '{"approved": true}'::JSON, -- message
    'approval'                 -- topic
);
```

## Source Code Confirmation (GitHub)

DBOS Python is open source: [github.com/dbos-inc/dbos-transact-py](https://github.com/dbos-inc/dbos-transact-py)

### Key Finding: Single Database, No Visibility Store

**`_sys_db.py`** ([source](https://github.com/dbos-inc/dbos-transact-py/blob/main/dbos/_sys_db.py))

This single file contains **both** the engine write operations AND the query operations:

```python
# Engine writes (checkpointing) — same table
def _insert_workflow_status(self, status, conn, ...):
    cmd = self.dialect.insert(SystemSchema.workflow_status).values(...)

# Query reads (observability) — same table
def list_workflows(self, ...):
    # Builds SELECT on SystemSchema.workflow_status with filters

# Management operations — same table
def cancel_workflows(self, workflow_ids):
    sa.update(SystemSchema.workflow_status)
      .where(...).values(status='CANCELLED')

def fork_workflow(self, ...):
    # Copies rows from workflow_status and operation_outputs
    # in a single Postgres transaction
```

**Key source code facts:**

- Uses **SQLAlchemy** ORM for all database operations
- `_sys_db_postgres.py` and `_sys_db_sqlite.py` provide database-specific implementations
- `fork_workflow` copies step checkpoints between workflows in a single transaction
- All operations are standard Postgres SQL — no custom query engine
- `cancel_workflows` and `resume_workflows` are simple `UPDATE` statements on `workflow_status`

### Query Impact on Execution

Since DBOS uses **standard Postgres**, query isolation follows Postgres's MVCC model:

- **Reads don't block writes** — Postgres MVCC provides snapshot isolation
- **Separate connections** — SDK queries and engine operations use separate connection pools
- **Postgres handles concurrency** — battle-tested, well-understood isolation guarantees
- **Heavy queries could affect Postgres performance** — but this is standard database behavior, not a shared-process concern like Restate

| Aspect                | DBOS                                     | Restate                        | Temporal                  |
| --------------------- | ---------------------------------------- | ------------------------------ | ------------------------- |
| **Query isolation**   | Postgres MVCC (reads don't block writes) | Shared RocksDB process         | Fully separate database   |
| **Query impact risk** | Standard DB load on shared Postgres      | I/O contention in same process | Zero — different database |
| **Mitigation**        | Read replicas, connection pooling        | None documented                | N/A                       |
| **Data freshness**    | Real-time (same tables)                  | Real-time (same store)         | Eventually consistent     |

## Unique Features

### Fork from Specific Step

DBOS uniquely supports **forking** a workflow from any step — creating a new workflow that reuses checkpoints up to that step, then re-executes from there. Useful for:

- Recovering from downstream outages
- Patching workflows that failed due to bugs
- Running "what-if" scenarios from a specific point

### Cross-Language Interoperability

Since all languages share the same Postgres schema, a Python workflow can be queried/managed from TypeScript and vice versa. PL/pgSQL functions enable workflow control from any Postgres client.

### Step-Level Timing (Automatic)

`dbos.operation_outputs` automatically records `started_at_epoch_ms` and `completed_at_epoch_ms` for every step — no custom instrumentation needed. You can query step durations out of the box.

## Limitations

- **Postgres dependency** — requires a Postgres database (or SQLite for dev)
- **No SQL-like query language** — filtering is via SDK parameters, not free-form SQL (though you can query Postgres directly)
- **No custom search attributes** — unlike Temporal, you can't add arbitrary indexed fields (but you get more built-in fields)
- **Single database scaling** — all workflow state in one Postgres instance (can use read replicas for queries)
- **No built-in Elasticsearch** — full-text search requires direct Postgres queries with `LIKE` or `tsvector`

## Access Methods

| Method             | Description                                               |
| ------------------ | --------------------------------------------------------- |
| **Python SDK**     | `DBOS.list_workflows()`, `DBOS.cancel_workflow()`, etc.   |
| **TypeScript SDK** | Equivalent methods via `@dbos-inc/dbos-sdk`               |
| **Go SDK**         | `github.com/dbos-inc/dbos-transact-golang`                |
| **Java SDK**       | DBOS Java client                                          |
| **CLI**            | `dbos workflow list`, `dbos workflow cancel`, etc.        |
| **Direct SQL**     | Query `dbos.*` tables with any Postgres client            |
| **PL/pgSQL**       | `dbos.enqueue_workflow()`, `dbos.send_message()` from SQL |
| **DBOS Console**   | Web UI with searchable workflow list and execution graphs |
