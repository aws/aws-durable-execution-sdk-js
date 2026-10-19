# Cloudflare Workflows Platform - API & Query Capabilities

## Overview

Cloudflare Workflows is a durable execution engine built on Cloudflare Workers and Durable Objects. It provides a **full public REST API** for workflow management, including listing, filtering, step-level introspection, lifecycle control, and event delivery. Step-level timing and retry data is returned **automatically** — no custom instrumentation needed.

## Architecture

- **Runtime**: Cloudflare Workers (V8 isolates at the edge)
- **Storage**: Durable Objects with SQLite (each workflow instance gets its own Durable Object)
- **No external database** — storage is fully managed by Cloudflare
- **No separate visibility store** — the API reads from the same Durable Objects that run the workflow
- **Edge-native** — runs globally on Cloudflare's network

## Execution Status Values (8)

| Status            | Description                                         |
| ----------------- | --------------------------------------------------- |
| `queued`          | Waiting to start                                    |
| `running`         | Currently executing                                 |
| `paused`          | Manually paused                                     |
| `errored`         | Failed with error                                   |
| `terminated`      | Manually terminated                                 |
| `complete`        | Finished successfully                               |
| `waitingForPause` | Pause requested, waiting for current step to finish |
| `waiting`         | Waiting for an external event (`waitForEvent`)      |

## REST API Endpoints

### Workflow Management

| Method   | Endpoint                                  | Description                                               |
| -------- | ----------------------------------------- | --------------------------------------------------------- |
| `GET`    | `/accounts/{account_id}/workflows`        | List all workflows                                        |
| `GET`    | `/accounts/{account_id}/workflows/{name}` | Get workflow details (includes instance counts by status) |
| `DELETE` | `/accounts/{account_id}/workflows/{name}` | Delete a workflow                                         |

### Instance Management

| Method  | Endpoint                                         | Description                                    |
| ------- | ------------------------------------------------ | ---------------------------------------------- |
| `GET`   | `/workflows/{name}/instances`                    | **List instances** with filters                |
| `GET`   | `/workflows/{name}/instances/{id}`               | **Get instance** with full step details        |
| `POST`  | `/workflows/{name}/instances`                    | Create new instance                            |
| `POST`  | `/workflows/{name}/instances/batch`              | Batch create instances                         |
| `PATCH` | `/workflows/{name}/instances/{id}/status`        | Change status (pause/resume/terminate/restart) |
| `POST`  | `/workflows/{name}/instances/{id}/events/{type}` | Send event to instance                         |

### List Instances — Filter Parameters

```bash
GET /accounts/{account_id}/workflows/{workflow_name}/instances
```

| Parameter    | Type   | Description                                                                                                        |
| ------------ | ------ | ------------------------------------------------------------------------------------------------------------------ |
| `status`     | string | Filter by status: `queued`, `running`, `paused`, `errored`, `terminated`, `complete`, `waitingForPause`, `waiting` |
| `date_start` | string | Filter instances created after (ISO 8601 UTC)                                                                      |
| `date_end`   | string | Filter instances created before (ISO 8601 UTC)                                                                     |
| `cursor`     | string | Cursor-based pagination token                                                                                      |
| `direction`  | string | Pagination direction: `asc` or `desc`                                                                              |
| `per_page`   | number | Results per page                                                                                                   |

```bash
# List all errored instances in a date range
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workflows/my-workflow/instances?status=errored&date_start=2024-01-01T00:00:00Z&date_end=2024-01-31T23:59:59Z" \
  -H "Authorization: Bearer $TOKEN"
```

### Get Instance — Automatic Step-Level Details

```bash
GET /accounts/{account_id}/workflows/{workflow_name}/instances/{instance_id}
```

| Parameter | Type   | Description                                                      |
| --------- | ------ | ---------------------------------------------------------------- |
| `order`   | string | Step ordering: `asc` (default) or `desc`                         |
| `simple`  | string | `true` to omit step details, return only metadata + `step_count` |

**Response includes full step-level data automatically:**

```json
{
  "result": {
    "status": "complete",
    "queued": "2024-01-15T10:00:00Z",
    "start": "2024-01-15T10:00:01Z",
    "end": "2024-01-15T10:05:30Z",
    "output": "result-data",
    "params": { "orderId": "123" },
    "trigger": { "source": "api" },
    "step_count": 3,
    "steps": [
      {
        "type": "step",
        "name": "validate-order",
        "start": "2024-01-15T10:00:01Z",
        "end": "2024-01-15T10:00:02Z",
        "success": true,
        "output": "validated",
        "config": {
          "retries": { "delay": "1000", "limit": 3, "backoff": "exponential" },
          "timeout": "30000"
        },
        "attempts": [
          {
            "start": "2024-01-15T10:00:01Z",
            "end": "2024-01-15T10:00:02Z",
            "success": true
          }
        ]
      },
      {
        "type": "sleep",
        "name": "cooldown",
        "start": "2024-01-15T10:00:02Z",
        "end": "2024-01-15T10:05:02Z",
        "finished": true
      },
      {
        "type": "step",
        "name": "process-payment",
        "start": "2024-01-15T10:05:02Z",
        "end": "2024-01-15T10:05:30Z",
        "success": true,
        "output": "payment-confirmed",
        "config": {
          "retries": { "delay": "2000", "limit": 5, "backoff": "linear" },
          "timeout": "60000"
        },
        "attempts": [
          {
            "start": "2024-01-15T10:05:02Z",
            "end": "2024-01-15T10:05:10Z",
            "success": false,
            "error": { "name": "TimeoutError", "message": "upstream timeout" }
          },
          {
            "start": "2024-01-15T10:05:12Z",
            "end": "2024-01-15T10:05:30Z",
            "success": true
          }
        ]
      }
    ]
  }
}
```

**Step types returned:**

- `step` — Business logic step (includes attempts, retry config, output)
- `sleep` — Timer/delay step
- `termination` — Workflow was terminated
- `waitForEvent` — Waiting for external event

**Per-attempt data (automatic, no instrumentation):**

- Start/end timestamps per attempt
- Success/failure per attempt
- Error details per failed attempt
- Retry configuration (delay, limit, backoff strategy)

### Lifecycle Control

```bash
# Pause an instance
curl -X PATCH ".../instances/$INSTANCE_ID/status" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"status": "pause"}'

# Resume
curl -X PATCH ".../instances/$INSTANCE_ID/status" \
  -d '{"status": "resume"}'

# Terminate
curl -X PATCH ".../instances/$INSTANCE_ID/status" \
  -d '{"status": "terminate"}'

# Restart (re-run from beginning)
curl -X PATCH ".../instances/$INSTANCE_ID/status" \
  -d '{"status": "restart"}'
```

### Send Events to Instances

```bash
# Send an event to trigger a waitForEvent step
curl -X POST ".../instances/$INSTANCE_ID/events/approval" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"approved": true}'
```

## Workers API (SDK)

```typescript
// Binding in wrangler.toml
// [[workflows]]
// name = "MY_WORKFLOW"
// binding = "MY_WORKFLOW"
// class_name = "MyWorkflow"

export default {
  async fetch(req, env) {
    // Create instance
    const instance = await env.MY_WORKFLOW.create({
      params: { orderId: "123" },
    });

    // Get instance status
    const status = await env.MY_WORKFLOW.get(instance.id);
    console.log(status.status); // 'running', 'complete', etc.

    // Pause/resume/terminate/restart
    await instance.pause();
    await instance.resume();
    await instance.terminate();
    await instance.restart();

    // Send event
    await instance.sendEvent("approval", { approved: true });
  },
};
```

### WorkflowEntrypoint (Defining Workflows)

```typescript
import {
  WorkflowEntrypoint,
  WorkflowStep,
  WorkflowEvent,
} from "cloudflare:workers";

export class MyWorkflow extends WorkflowEntrypoint {
  async run(event: WorkflowEvent, step: WorkflowStep) {
    const validated = await step.do("validate", async () => {
      return validate(event.payload);
    });

    await step.sleep("cooldown", "5 minutes");

    const result = await step.do(
      "process",
      {
        retries: { limit: 3, delay: "1 second", backoff: "exponential" },
        timeout: "30 seconds",
      },
      async () => {
        return process(validated);
      },
    );

    return result;
  }
}
```

## Instance Retention

Configurable per-instance when creating:

```bash
curl -X POST ".../instances" \
  -d '{
    "params": {"orderId": "123"},
    "instance_retention": {
      "success_retention": "7 days",
      "error_retention": "30 days"
    }
  }'
```

## Trigger Source Tracking

Every instance automatically tracks how it was triggered:

| Source    | Description                  |
| --------- | ---------------------------- |
| `api`     | Created via REST API         |
| `binding` | Created via Workers binding  |
| `event`   | Triggered by an event        |
| `cron`    | Triggered by a cron schedule |
| `unknown` | Source not determined        |

## What's Queryable Without Custom Instrumentation

| Data                      | Available | How                                    |
| ------------------------- | --------- | -------------------------------------- |
| Instance status           | ✅        | List API filter                        |
| Date range                | ✅        | List API `date_start`/`date_end`       |
| Step names                | ✅        | Instance get response                  |
| Step start/end times      | ✅        | Instance get response                  |
| Per-attempt timing        | ✅        | Instance get response (attempts array) |
| Retry config per step     | ✅        | Instance get response                  |
| Step output               | ✅        | Instance get response                  |
| Error details per attempt | ✅        | Instance get response                  |
| Trigger source            | ✅        | Instance get response                  |
| Workflow input params     | ✅        | Instance get response                  |
| Workflow output           | ✅        | Instance get response                  |

## Limitations

### Filtering

- **List filter is limited** — only `status`, `date_start`, `date_end` (no filtering by step name, workflow input, or custom attributes)
- **No SQL-like query language** — unlike Temporal or Restate
- **No cross-workflow step queries** — can't query "all instances where step X failed" without iterating
- **Per-workflow listing only** — must specify workflow name; can't list instances across all workflows

### Step-Level Data

- Step details are only available on **individual instance get** — not on the list endpoint
- No way to aggregate step-level metrics across instances via API
- No custom search attributes

### Architecture

- **Closed source** — can't inspect internal implementation
- **Cloudflare-only** — no self-hosted option
- **Durable Objects limits** — subject to Cloudflare platform limits

## Comparison: Step-Level Introspection

| Platform               | Step timing        | Per-attempt data    | Retry config | Via API                | Custom instrumentation needed |
| ---------------------- | ------------------ | ------------------- | ------------ | ---------------------- | ----------------------------- |
| **Cloudflare**         | ✅                 | ✅ (attempts array) | ✅           | REST API               | None                          |
| **DBOS**               | ✅                 | ❌                  | ❌           | SDK + SQL              | None                          |
| **Restate**            | ❌ (no timestamps) | ❌                  | ❌           | SQL                    | None                          |
| **Temporal**           | ❌                 | ❌                  | ❌           | Only via event history | Manual (custom search attrs)  |
| **AWS Lambda Durable** | ❌                 | ❌                  | ❌           | REST API               | N/A                           |
| **Vercel Workflow**    | ❌                 | ❌                  | ❌           | Dashboard only         | N/A                           |

## Access Methods

| Method                   | Description                                                         |
| ------------------------ | ------------------------------------------------------------------- |
| **REST API**             | Full CRUD + filtering + step details + lifecycle control            |
| **Workers API (SDK)**    | `env.WORKFLOW.create()`, `.get()`, `.pause()`, `.terminate()`, etc. |
| **Cloudflare Dashboard** | Web UI for viewing workflows and instances                          |
| **Wrangler CLI**         | Deployment and configuration                                        |
