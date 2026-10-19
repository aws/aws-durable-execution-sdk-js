# Durable Execution Telemetry — Positioning Among Observability Pillars

## Where Durable Execution Telemetry Sits

Durable Execution Telemetry is not a replacement for Logs, Metrics, Traces, or Events. It borrows from each, overlaps with each, but serves a purpose none of them can fulfill alone: **cross-execution, step-level, business-dimension-aware querying of workflow lifecycle data.**

```
                    ┌─────────────────────────────────┐
                    │       Durable Execution Telemetry           │
                    │                                 │
                    │  • Cross-execution queries      │
                    │  • Step-level detail            │
                    │  • Business dimensions          │
                    │  • Curated & updatable          │
                    └──────────┬──────────────────────┘
                               │
            ┌──────────────────┼──────────────────────┐
            │                  │                      │
     ┌──────▼──────┐   ┌──────▼──────┐   ┌──────────▼────┐   ┌──────────┐
     │    Logs     │   │   Traces    │   │    Events     │   │  Metrics │
     │             │   │             │   │               │   │          │
     │ What code   │   │ Request     │   │ State change  │   │ Counts & │
     │ printed     │   │ flow across │   │ notifications │   │ gauges   │
     │ per invoc.  │   │ services    │   │ (push-based)  │   │ over time│
     └─────────────┘   └─────────────┘   └───────────────┘   └──────────┘
```

## Relationship to Each Pillar

### Similar to Traces — but queryable across executions

|                 | Traces                                                                                    | Durable Execution Telemetry                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Shows**       | One request flowing through services                                                      | One execution flowing through steps                                                                     |
| **Scope**       | Single request, single moment                                                             | Single execution, possibly spanning days                                                                |
| **Big picture** | Can aggregate traces to find latency hotspots                                             | Can aggregate executions to find failing steps, slow paths                                              |
| **Overlap**     | Both show step-by-step flow with timing                                                   | Both show step-by-step flow with timing                                                                 |
| **Difference**  | Designed for request-response; hard to query "all traces where service X failed" at scale | Designed for cross-execution queries: "all executions where step X failed this week" is a simple filter |
| **Difference**  | Per-request sampling, no business context                                                 | Per-execution, carries business dimensions (customerId, region, etc.)                                   |
| **Difference**  | Immutable once written                                                                    | Updatable — record evolves as execution progresses                                                      |

### Similar to Logs — but curated and updatable

|                | Logs                                                                             | Durable Execution Telemetry                                                          |
| -------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Format**     | Free-form text or structured JSON per invocation                                 | Curated JSON summary per execution                                        |
| **Emission**   | Every `console.log()` / `logger.info()` call                                     | One record per execution (or per status change in in-progress mode)       |
| **Overlap**    | Both emit structured data to destinations (CloudWatch, S3, third-party)          | Both emit structured data to destinations                                 |
| **Overlap**    | Both can be queried with Log Insights, Athena, etc.                              | Both can be queried with the same tools                                   |
| **Difference** | Raw, verbose, one invocation at a time — thousands of log lines per execution    | Curated summary — one record per execution, pre-aggregated                |
| **Difference** | Immutable (append-only)                                                          | Updatable — in-progress mode overwrites previous record with latest state |
| **Difference** | Querying across executions requires parsing and joining thousands of log entries | Querying across executions is a single `WHERE` clause on flat records     |
| **Difference** | Cost scales with verbosity (every log line costs)                                | Cost scales with executions × record size (curated = cheaper at scale)    |

### Similar to Events — but richer and queryable

|                   | Events                                                                | Durable Execution Telemetry                                                    |
| ----------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Trigger**       | State change happens → event emitted                                  | Status change happens → curated record emitted/updated              |
| **Push/Pull**     | Push-based (EventBridge routes to targets)                            | Pull-based (query your destination when you need answers)           |
| **Overlap**       | Both fire on execution lifecycle changes (started, completed, failed) | Both fire on execution lifecycle changes                            |
| **Difference**    | Minimal payload — "execution X stopped" with basic metadata           | Rich payload — full step timeline, durations, errors, custom fields |
| **Difference**    | Designed for real-time reaction (trigger Lambda, page on-call)        | Designed for after-the-fact querying and analysis                   |
| **Difference**    | No cross-event querying — each event is independent                   | Cross-execution querying is the primary use case                    |
| **Difference**    | Works for server-side terminations (STOPPED, TIMED_OUT)               | Cannot cover server-side terminations (plugin doesn't run)          |
| **Complementary** | Events cover our blind spot (server-side state changes)               | We cover Events' blind spot (rich queryable context)                |

### Different from Metrics — but enables the same questions

|                   | Metrics                                                                 | Durable Execution Telemetry                                                       |
| ----------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Data**          | Numeric aggregates (counts, gauges, histograms)                         | Individual execution records with detail                               |
| **Overlap**       | Both answer "how many failed?" and "what's the p99 duration?"           | Both answer aggregate questions                                        |
| **Difference**    | No per-execution detail — can't drill into _which_ ones failed or _why_ | Every record is an individual execution you can inspect                |
| **Difference**    | Pre-aggregated, cheap, real-time dashboards                             | Raw detail, more expensive, but enables any ad-hoc query               |
| **Difference**    | Fixed dimensions (function name, status)                                | Custom dimensions (customerId, region, orderAmount — anything)         |
| **Complementary** | Metrics tell you _something is wrong_ (alarm fires)                     | Durable Execution Telemetry tells you _what's wrong and for whom_ (investigation) |

## Summary: Overlaps and Gaps

| Capability                              | Logs              | Metrics          | Traces            | Events         | Durable Execution Telemetry        |
| --------------------------------------- | ----------------- | ---------------- | ----------------- | -------------- | ----------------------- |
| What happened in one execution?         | ✅ (verbose)      | ❌               | ✅                | Partial        | ✅ (curated)            |
| What happened across all executions?    | ❌ (requires ETL) | ✅ (counts only) | ❌ (per-request)  | ❌ (per-event) | ✅                      |
| Which step failed?                      | ✅ (grep logs)    | ❌               | ✅ (which span)   | ❌             | ✅                      |
| Which step is slowest across the fleet? | ❌                | ❌               | Partial (sampled) | ❌             | ✅                      |
| Filter by business dimension?           | Only if logged    | ❌               | ❌                | ❌             | ✅                      |
| React in real time?                     | ❌                | ✅ (alarms)      | ❌                | ✅             | Partial (in-progress)   |
| Cover server-side terminations?         | ❌                | ✅               | ❌                | ✅             | ❌                      |
| Updatable as execution progresses?      | ❌                | N/A              | ❌                | ❌             | ✅                      |
| Cheap at scale?                         | ❌ (verbose)      | ✅               | ⚠️ (sampling)     | ✅             | ✅ (curated + sampling) |

## The Telemetry We Offer That No Pillar Covers Alone

> "Show me all executions for customer X that failed at the payment step after retrying 3 times, grouped by region, over the last 7 days."

- **Logs** can't — would require parsing billions of log lines across thousands of executions
- **Metrics** can't — no per-execution detail, no step-level, no customer dimension
- **Traces** can't — per-request, no cross-execution aggregation, no business dimensions
- **Events** can't — no step-level detail, no retry count, no cross-event querying

**Durable Execution Telemetry** answers this in one query against a flat table of curated records.

## How They Work Together

```
Metrics ──── "Something is wrong" (alarm fires: error rate spiked)
    │
    ▼
Durable Execution Telemetry ──── "What's wrong and for whom" (filter failed executions,
    │                  group by step, find the pattern)
    ▼
Traces ──── "What happened in this specific call" (drill into one execution's
    │        service-to-service flow)
    ▼
Logs ──── "What exactly did the code do" (read the raw output of one invocation)

Events ──── "React immediately" (trigger automation, page on-call, cancel stuck workflows)
```

Each pillar answers a different question at a different phase of the investigation. Durable Execution Telemetry sits between Metrics (fleet-wide signal) and Traces (single-request detail) — it's the **investigation layer** that helps you go from "something is wrong" to "here's exactly what and for whom" before you dive into individual execution details.
