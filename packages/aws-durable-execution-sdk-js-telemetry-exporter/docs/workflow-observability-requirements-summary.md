# Workflow Observability Requirements — Summary

**34 requirements** across **11 themes**, researched from 25+ service types. No platform covers more than ~15 natively.

---

## Platform Coverage Matrix

**Te** = Temporal, **Re** = Restate, **DB** = DBOS, **CF** = Cloudflare, **AW** = AWS Lambda Durable, **Az** = Azure Durable

| #   | Requirement                                      | Te  | Re  | DB  | CF  | AW  | Az  |
| --- | ------------------------------------------------ | --- | --- | --- | --- | --- | --- |
|     | **A. Real-Time Operational Awareness**           |     |     |     |     |     |     |
| 1   | Stuck workflow detection                         | ⚠️  | ⚠️  | ⚠️  | ❌  | ❌  | ❌  |
| 19  | Throughput & queue depth                         | ✅  | ❌  | ⚠️  | ❌  | ⚠️  | ⚠️  |
| 23  | Progress / ETA during execution                  | ⚠️  | ❌  | ❌  | ❌  | ❌  | ❌  |
| 34  | Effective availability / dependency-aware uptime | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
|     | **B. Failure Diagnosis**                         |     |     |     |     |     |     |
| 2   | Step-level error attribution                     | ⚠️  | ✅  | ✅  | ✅  | ❌  | ⚠️  |
| 5   | Specific workflow lookup & timeline              | ✅  | ✅  | ✅  | ✅  | ⚠️  | ✅  |
| 9   | Soft failures / retry tracking                   | ⚠️  | ⚠️  | ❌  | ✅  | ❌  | ❌  |
| 21  | Partial failure in parallel branches             | ⚠️  | ❌  | ❌  | ✅  | ❌  | ❌  |
| 17  | Replay / reproduce locally                       | ✅  | ⚠️  | ❌  | ❌  | ❌  | ❌  |
|     | **C. Performance Analysis**                      |     |     |     |     |     |     |
| 3   | Per-step duration tracking                       | ⚠️  | ❌  | ✅  | ✅  | ❌  | ⚠️  |
| 25  | Batch window / deadline forecast                 | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
| 33  | Compute vs wait time breakdown                   | ❌  | ❌  | ❌  | ⚠️  | ❌  | ❌  |
| 32  | Workflow internal health (history size)          | ✅  | ❌  | ❌  | ❌  | ⚠️  | ❌  |
|     | **D. Search & Discovery**                        |     |     |     |     |     |     |
| 6   | Cross-workflow search & filtering                | ✅  | ✅  | ✅  | ⚠️  | ⚠️  | ⚠️  |
| 7   | Bulk operations                                  | ✅  | ❌  | ⚠️  | ❌  | ❌  | ❌  |
|     | **E. Business Outcomes & SLAs**                  |     |     |     |     |     |     |
| 4   | SLA breach alerting                              | ⚠️  | ❌  | ❌  | ❌  | ❌  | ❌  |
| 26  | STP / automation rate                            | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
| 35  | Analytics / BI by business dimensions            | ❌  | ❌  | ⚠️  | ❌  | ❌  | ❌  |
|     | **F. Data Integrity & Correctness**              |     |     |     |     |     |     |
| 20  | Output correctness validation                    | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
| 22  | Data freshness / staleness                       | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
| 27  | Cross-party reconciliation                       | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
| 28  | Schema / contract drift detection                | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
| 30  | Safety invariant monitoring                      | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
|     | **G. Lifecycle Management**                      |     |     |     |     |     |     |
| 11  | Version distribution visibility                  | ✅  | ❌  | ✅  | ⚠️  | ❌  | ❌  |
| 16  | Missed schedule detection                        | ❌  | ❌  | ⚠️  | ❌  | ❌  | ❌  |
| 24  | Execution overlap / collision detection          | ❌  | ❌  | ⚠️  | ❌  | ❌  | ❌  |
| 31  | Resource leak / orphaned hold detection          | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
| 29  | Desired vs actual state convergence              | ❌  | ❌  | ❌  | ❌  | ❌  | ❌  |
|     | **H. External Integration & Export**             |     |     |     |     |     |     |
| 8   | OTel / APM integration                           | ✅  | ✅  | ✅  | ❌  | ⚠️  | ✅  |
| 18  | Real-time notifications / webhooks               | ⚠️  | ❌  | ⚠️  | ✅  | ❌  | ❌  |
|     | **I. Security, Compliance & Governance**         |     |     |     |     |     |     |
| 12  | Audit trail / compliance                         | ✅  | ⚠️  | ✅  | ❌  | ❌  | ⚠️  |
| 13  | PII redaction in observability                   | ✅  | ❌  | ❌  | ❌  | ❌  | ❌  |
|     | **J. Cost & Resource Attribution**               |     |     |     |     |     |     |
| 15  | Cost / resource attribution                      | ❌  | ❌  | ❌  | ⚠️  | ⚠️  | ❌  |
|     | **K. Dependency & Impact Analysis**              |     |     |     |     |     |     |
| 14  | Blast radius / dependency mapping                | ⚠️  | ❌  | ⚠️  | ❌  | ❌  | ❌  |

**Coverage:** Temporal 50% · DBOS 35% · Cloudflare 24% · Restate 21% · AWS/Azure 12%

---

## Requirements by Theme

### A. Real-Time Operational Awareness

| #   | Category               | Data to Capture                                                    | Queries                                     | Alerts & UX                       |
| --- | ---------------------- | ------------------------------------------------------------------ | ------------------------------------------- | --------------------------------- |
| 1   | Stuck detection        | Workflow status, last progress timestamp, queue depth              | Workflows RUNNING past expected duration    | Stuck alerts, progress indicators |
| 19  | Throughput & capacity  | Workflows/sec, queue wait time, worker utilization, concurrency    | Capacity forecasting, rate limit visibility | —                                 |
| 23  | Progress & ETA         | Progress %, throughput rate, items processed/total, heartbeat data | Progress history (stable/degrading)         | ETA display                       |
| 34  | Effective availability | Success rate over time, dependency map, downtime attribution       | Dependency health impact, SLA composition   | Availability trending             |

### B. Failure Diagnosis

| #   | Category                 | Data to Capture                                                                     | Queries                               | Alerts & UX                                |
| --- | ------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------ |
| 2   | Why did it fail?         | Step-level error, error context (inputs/outputs/state), retry history, stack traces | Filter by failure category            | —                                          |
| 5   | Specific workflow lookup | Full timeline, input/output per step, trigger source, parent/child relationships    | Lookup by business ID, query handlers | —                                          |
| 9   | Soft failures            | Retry rate per step, soft error categories, success-with-retries distinction        | Downstream health inference           | Degradation alerting                       |
| 21  | Parallel branch failures | Per-branch status, conditional path taken, critical path data                       | Critical path analysis                | Partial failure alerts, path visualization |
| 17  | Replay locally           | Exportable execution history                                                        | Replay compatibility testing          | Local replay, step-through debugging       |

### C. Performance Analysis

| #   | Category                 | Data to Capture                                                                                | Queries                                           | Alerts & UX                                      |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| 3   | Why is it slow?          | Per-step start/end time, duration percentiles                                                  | Bottleneck identification, dependency correlation | Anomaly detection                                |
| 25  | Batch window             | Window utilization trending, critical chain                                                    | Rerun impact analysis                             | Window completion forecast, breach early warning |
| 33  | Compute vs wait          | Compute time vs wall-clock per step, resume latency, replay overhead, suspend/resume frequency | Idle cost verification                            | —                                                |
| 32  | Workflow internal health | Event history size, replay duration, worker memory, workflow age, continueAsNew tracking       | —                                                 | Platform limit proximity alerts                  |

### D. Search & Discovery

| #   | Category              | Data to Capture                                  | Queries                                                     | Alerts & UX                 |
| --- | --------------------- | ------------------------------------------------ | ----------------------------------------------------------- | --------------------------- |
| 6   | Cross-workflow search | Custom search attributes (indexed business data) | Multi-criteria filtering, step-level filtering, aggregation | Saved queries/views         |
| 7   | Bulk operations       | —                                                | Bulk cancel/terminate/retry/pause by query                  | Rate limiting, dry-run mode |

### E. Business Outcomes & SLAs

| #   | Category              | Data to Capture                                                               | Queries                                              | Alerts & UX                           |
| --- | --------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------- |
| 4   | SLA compliance        | End-to-end duration (business time), completion rate, business-tagged metrics | SLA breach queries, trends                           | SLA breach alerting, trend dashboards |
| 26  | STP / automation rate | Automation %, exception/fallout tracking, fallout by step                     | STP trending, cost of manual intervention            | —                                     |
| 35  | Analytics & BI        | Aggregate duration metrics, business dimension tags                           | Cohort analysis, trend by dimension, funnel analysis | Distribution visualization            |

### F. Data Integrity & Correctness

| #   | Category           | Data to Capture                                                          | Queries                                                | Alerts & UX                              |
| --- | ------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------- |
| 20  | Output correctness | Output assertions, comparison with previous runs                         | Anomaly detection on outputs, business rule validation | Silent failure alerting                  |
| 22  | Data freshness     | Freshness per output, freshness SLAs, upstream propagation               | —                                                      | Staleness alerting, freshness dashboard  |
| 27  | Reconciliation     | Match rate, break/mismatch records, field-level detail                   | Break aging                                            | Reconciliation dashboard                 |
| 28  | Schema drift       | Schema versions, contract validation results                             | Impact analysis, backward compatibility checks         | Schema change alerting                   |
| 30  | Safety invariants  | Continuous invariant checks, proof of compliance, degraded mode tracking | Conflict detection                                     | Invariant violation alerting (immediate) |

### G. Lifecycle Management

| #   | Category          | Data to Capture                               | Queries                                                              | Alerts & UX                                         |
| --- | ----------------- | --------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------- |
| 11  | Version safety    | Version tag per workflow                      | Version distribution, version-tagged filtering, replay compatibility | Deployment safety checks, migration tracking        |
| 16  | Missed schedules  | Schedule execution history, backfill tracking | —                                                                    | Missed schedule alerting, schedule health dashboard |
| 24  | Execution overlap | Concurrent execution count                    | Collision impact tracking                                            | Overlap alerting, prevention policies               |
| 31  | Resource leaks    | Resource hold registry, TTL per hold          | Orphaned resource detection, leak trending                           | Cleanup verification alerting                       |
| 29  | Desired vs actual | Convergence rate, convergence time            | Non-converged targets, rollout progress                              | Divergence alerting                                 |

### H. External Integration & Export

| #   | Category      | Data to Capture                                               | Queries              | Alerts & UX                                                                           |
| --- | ------------- | ------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| 8   | OTel / APM    | Structured logs with workflow ID, replay-safe instrumentation | CDC/streaming export | OTel traces (span links), metrics export, webhook hooks                               |
| 18  | Notifications | Event stream                                                  | —                    | Webhooks on lifecycle events, configurable channels, selective subscriptions, UI push |

### I. Security, Compliance & Governance

| #   | Category       | Data to Capture                     | Queries                                        | Alerts & UX                                                  |
| --- | -------------- | ----------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| 12  | Audit trail    | User attribution, immutable history | Export for auditors, retention policies        | Access control on observability                              |
| 13  | PII protection | Codec/encryption at rest            | Selective visibility (names+timing, hide data) | Payload redaction, role-based access, configurable retention |

### J. Cost & Resource Attribution

| #   | Category         | Data to Capture                                      | Queries     | Alerts & UX   |
| --- | ---------------- | ---------------------------------------------------- | ----------- | ------------- |
| 15  | Cost attribution | Per-workflow cost, per-step cost, token/API tracking | Cost trends | Budget alerts |

### K. Dependency & Impact Analysis

| #   | Category     | Data to Capture                            | Queries                                     | Alerts & UX                                  |
| --- | ------------ | ------------------------------------------ | ------------------------------------------- | -------------------------------------------- |
| 14  | Blast radius | Dependency map, parent-child relationships | Impact analysis, cross-workflow correlation | Proactive dependency alerting, visualization |

---

## Priority-Ranked Requirements

| P      | #   | Requirement                   | Audience          | Platform Support                                           |
| ------ | --- | ----------------------------- | ----------------- | ---------------------------------------------------------- |
| **P0** | 1   | Stuck workflow detection      | On-call           | Poor — no platform detects "running but not progressing"   |
| **P0** | 2   | Step-level error attribution  | All engineers     | Mixed — CF/DBOS good, Te/AW poor without instrumentation   |
| **P0** | 5   | Lookup by business ID         | Support           | Only Te (custom attrs) and DB (direct SQL)                 |
| **P0** | 30  | Safety invariant violation    | Safety/Compliance | No platform provides continuous invariant monitoring       |
| **P1** | 3   | Per-step duration             | Performance       | DBOS/CF automatic; others need instrumentation             |
| **P1** | 4   | SLA breach alerting           | Business          | No platform natively                                       |
| **P1** | 7   | Bulk operations               | Incident response | Only Temporal                                              |
| **P1** | 8   | OTel/APM integration          | Platform          | Te (interceptors), Re (auto), DB (integration)             |
| **P1** | 11  | Version distribution          | Release eng       | DBOS/Temporal; others limited                              |
| **P1** | 14  | Blast radius                  | SRE               | No platform natively                                       |
| **P1** | 16  | Missed schedule detection     | On-call/Data      | DBOS partial; others none                                  |
| **P1** | 18  | Real-time notifications       | All engineers     | CF (events API); most require polling                      |
| **P1** | 19  | Throughput monitoring         | SRE/Platform      | Temporal (SDK metrics); others limited                     |
| **P1** | 20  | Output correctness            | Data/All          | No platform — all track status, none track correctness     |
| **P1** | 21  | Partial failure (parallel)    | All engineers     | CF (step-level); most report overall status only           |
| **P1** | 23  | Progress / ETA                | All engineers     | Te (heartbeats — manual); no automatic tracking            |
| **P1** | 24  | Execution overlap             | Data/SRE          | DBOS (dedup_id); most have none                            |
| **P1** | 25  | Batch window forecast         | SRE/Ops           | Mainframe schedulers only; no modern platform              |
| **P1** | 31  | Resource leak detection       | Ops/SRE           | No platform tracks orphaned holds                          |
| **P1** | 32  | Workflow internal health      | Platform/SRE      | Te (HistoryLength attrs); others none                      |
| **P1** | 33  | Compute vs wait breakdown     | Platform/Finance  | No platform breaks down compute vs idle                    |
| **P1** | 34  | Effective availability        | SRE/Business      | No platform tracks composite dependency uptime             |
| **P2** | 6   | Cross-workflow search         | Analytics         | Te (SQL-like), Re (SQL), DB (direct SQL)                   |
| **P2** | 9   | Retry/soft error tracking     | SRE               | CF (attempts array); others need instrumentation           |
| **P2** | 12  | Audit trail                   | Compliance        | DBOS/Temporal; others limited                              |
| **P2** | 13  | PII redaction                 | Security          | Temporal (Payload Codec); others none                      |
| **P2** | 15  | Cost attribution              | Eng managers      | No platform natively                                       |
| **P2** | 17  | Replay locally                | All engineers     | Temporal (replay testing); others none                     |
| **P2** | 22  | Data freshness                | Data eng          | Dagster (freshness policies); no workflow-as-code platform |
| **P2** | 26  | STP / automation rate         | Ops/Business      | No platform tracks this                                    |
| **P2** | 27  | Reconciliation                | Ops/Finance       | Domain-specific tooling required                           |
| **P2** | 28  | Schema drift                  | Data/Platform     | ETL tools handle separately                                |
| **P2** | 29  | Desired vs actual convergence | IoT/Platform      | IoT platforms only; no workflow platform                   |
| **P2** | 35  | Analytics / BI                | Business/Product  | Requires external analytics                                |
| **P3** | 25b | Critical path analysis        | Performance       | No platform natively                                       |

---

## Key Findings

- **Theme F (Data Integrity)** is a universal blind spot — ❌ across all platforms, all 5 categories
- **Theme G (Lifecycle Management)** is almost entirely unsupported — only DBOS has partial coverage
- **Temporal** has broadest coverage but still misses 17 of 34
- **AWS/Azure** managed platforms cover least — simplicity at the cost of observability
- No platform covers output correctness, safety invariants, dependency-aware uptime, or batch window forecasting
