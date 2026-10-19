# Workflow Observability Requirements (Rev 2)

> **What changed from rev 1:** The original 35 flat categories have been regrouped into themes, overlapping categories have been merged or clarified, observability _primitives_ have been separated from _derived metrics_, and scope boundaries have been made explicit. The underlying content is preserved — only the structure, priorities, and framing have changed.

---

## How to read this document

Workflow observability needs fall into three tiers:

1. **Primitives** — things the platform must instrument and emit (step timing, error attribution, event history, heartbeats). Without these, nothing else works.
2. **Operational views** — dashboards, alerts, and investigation flows built directly on primitives (stuck detection, failure root cause, lookup by ID).
3. **Derived metrics** — business-level KPIs computed by aggregating primitives over time (STP rate, effective availability, BI analytics).

Each category below is tagged with its tier. When evaluating a platform, start with primitives — missing primitives cannot be backfilled by tooling.

---

## Scope & non-goals

**In scope:**

- Observability of workflow execution: status, timing, errors, progress, outputs, dependencies, and lifecycle events
- Cross-cutting concerns that apply specifically to workflows (PII in payloads, replay-safe instrumentation, async tracing)
- Workflow-specific derived metrics (STP rate, batch window forecasts, effective availability)

**Out of scope:**

- General APM / infrastructure monitoring (host CPU, network, disk) — covered by standard observability tools
- Application logs unrelated to workflow steps
- Generic AI/LLM observability unrelated to workflow execution (see Theme I for the workflow-specific slice)
- Business analytics unrelated to workflow execution patterns

---

## Theme A: Liveness & Progress

_"Is this workflow alive and moving forward?"_

### A1. Stuck detection & progress tracking [P0, Operational view]

Merges rev 1 Cat 1 (stuck detection) and Cat 23 (progress/ETA). These are two views of the same question — Cat 1 is the binary alert ("is it stuck?") and Cat 23 is the granular view ("how far along?"). A single progress signal answers both.

**Primitives required:** structured heartbeats with throughput data, step start/end events, expected-duration metadata per step.

**What's needed:**

- Real-time count of workflows by status (running, queued, failed, stuck)
- Stuck detection — workflows in RUNNING state past expected duration with no heartbeat progress
- Progress percentage and ETA during in-flight execution
- Throughput rate (items processed per second/minute)
- Queue depth and backlog monitoring
- Progress history — is throughput stable, increasing, or degrading?

**Why this matters:** A workflow sitting RUNNING for 7 hours with no errors, no latency spikes, and all dashboards green — while the customer's order hasn't moved — is the most commonly reported observability gap. Empty heartbeats tell you a workflow is alive but not whether it's 10% or 90% done.

### A2. Workflow internal health [P1, Primitive + Operational view]

Preserved from rev 1 Cat 32. Distinct from A1 because it's about the workflow-engine's view of the workflow (history size, replay time, worker memory) rather than business progress. Matters most for long-running workflows and the workflow-as-scheduler pattern.

**What's needed:**

- Event history size monitoring — approaching platform limits?
- Replay duration tracking — is it getting slower on new workers?
- Worker memory per workflow
- `continueAsNew` tracking — iterations since last reset
- Workflow age monitoring
- Platform limit proximity alerts (history size, timeout, retention)

---

## Theme B: Failure Attribution

_"Why did it fail, and where exactly?"_

### B1. Step-level error attribution [P0, Primitive + Operational view]

Merges rev 1 Cat 2 (why did it fail) and Cat 21's partial-failure concern (parallel branch failures). A parallel branch failure is step-level error attribution in a parallel context — same primitive, different visualization.

**Primitives required:** per-step error records with inputs/outputs, retry history, stack traces, branch/path identifiers for parallel execution.

**What's needed:**

- Which specific step failed and why
- Error context — inputs, outputs, state at point of failure
- Retry history — how many attempts, what errors on each
- Failure categorization — transient vs permanent, infrastructure vs business logic
- Stack traces for code-level debugging
- Per-branch status in fan-out/fan-in patterns — alert when some branches fail even if workflow "succeeds"
- Conditional path tracking — which if/else branch was taken

### B2. Soft failures & degradation signals [P2, Operational view]

Preserved from rev 1 Cat 9. Genuinely distinct from B1: this is about success-with-retries as an early-warning signal, not about failures themselves.

**What's needed:**

- Retry rate tracking per step and per workflow type over time
- Soft error categorization — transient errors handled but indicating degradation
- Success-with-retries vs clean-success distinction
- Downstream health inference from retry patterns

---

## Theme C: Performance

_"Why is it slow, and where is the time going?"_

### C1. Per-step duration & bottleneck analysis [P1, Primitive + Operational view]

Merges rev 1 Cat 3 and the "critical path" bullet from Cat 21. Critical path analysis is a performance question, not an execution-path question.

**What's needed:**

- Per-step duration tracking (start and end time for every step)
- Duration trends over time — p50/p95/p99 per step, per workflow type
- Anomaly detection — "this step is 10x slower than its 7-day average"
- Bottleneck identification — which step contributes most to total duration
- Critical path analysis — which sequence of steps determined total wall-clock duration
- Downstream dependency correlation — slow step → slow external API

### C2. Compute vs wait time breakdown [P1, Primitive]

Preserved from rev 1 Cat 33. Specific to durable execution: wall-clock duration is almost meaningless when workflows suspend and resume.

**What's needed:**

- Compute time vs wall-clock time breakdown per workflow and per step
- Resume latency tracking — time from "event received" to "code executing"
- Replay/rehydration overhead — how much of resume is replay vs new work
- Suspend/resume frequency
- Idle cost verification — confirm pay-per-compute billing excludes wait time

---

## Theme D: Correctness

_"Execution succeeded, but was the outcome actually right?"_

A shared theme: **execution status ≠ correctness.** Every category in this theme exists because workflow platforms universally track the former and ignore the latter.

### D1. Output correctness & validation [P1, Operational view]

Preserved from rev 1 Cat 20. Internal validation — does the step output match expected shape, range, count, or business rules?

**What's needed:**

- Output assertions — validate step outputs against schemas, ranges, counts
- Anomaly detection on outputs — "this step usually returns 10K rows, today it returned 3"
- Business rule validation
- Comparison with previous runs
- Silent failure alerting — detect when a step "succeeds" but produces empty/invalid results

### D2. Schema & contract drift [P2, Operational view]

Preserved from rev 1 Cat 28. The shape of data changed underneath a workflow that still "succeeds."

**What's needed:**

- Schema change detection on inputs and outputs
- Schema versioning and evolution tracking
- Contract validation before processing
- Impact analysis — "this schema changed → these workflows are affected"
- Backward compatibility checks

### D3. Cross-party reconciliation [P2, Operational view]

Preserved from rev 1 Cat 27. External validation — do both sides (workflow + counterparty) see the same thing?

**What's needed:**

- Match rate monitoring across systems
- Break/mismatch detection between internal and external records
- Break aging — how long unresolved
- Field-level mismatch detail
- Reconciliation dashboard

### D4. Desired vs actual state convergence [P2, Operational view]

Preserved from rev 1 Cat 29. Target validation — did the target system actually converge to the desired state after the command was sent?

**What's needed:**

- Convergence rate — percentage of targets reaching desired state
- Convergence time — delay between command sent and state confirmed
- Non-converged target identification
- Divergence alerting when desired ≠ actual past threshold
- Rollout progress (e.g., "7,342 of 10,000 devices updated")

### D5. Safety invariant monitoring [P0, Primitive + Operational view]

Preserved from rev 1 Cat 30. Continuous validation during execution, not post-hoc. Distinct from D1–D4 because violations must be detected and acted on _immediately_, at every state transition.

**What's needed:**

- Continuous invariant checking at every state transition
- Immediate violation alerting
- Proof of compliance — auditable evidence invariants held throughout execution
- Degraded mode tracking
- Conflict detection across concurrent workflows (mutual exclusion)

---

## Theme E: SLAs & Commitments

_"Are we meeting the promises we made?"_

Three flavors of the same core question, differing by scope:

### E1. Per-workflow SLA [P1, Derived metric]

Preserved from rev 1 Cat 4.

**What's needed:**

- End-to-end workflow duration (business time, not engine time)
- SLA breach detection and alerting
- Completion rate by workflow type
- Trend dashboards
- Business-tagged metrics (customer tier, region, workflow type)

### E2. Batch window / processing deadline [P1, Derived metric]

Preserved from rev 1 Cat 25. Shared deadline across a _group_ of workflows. One slow job blows the window for everything downstream.

**What's needed:**

- Window completion forecast based on current progress
- Critical chain identification across dependent jobs
- Window utilization trending
- Rerun impact analysis
- Early window-breach warnings

### E3. Effective availability / dependency-aware uptime [P1, Derived metric]

Preserved from rev 1 Cat 34. Composite SLA — the intersection of all dependency availabilities, not just engine uptime.

**What's needed:**

- Effective workflow success rate over time
- Dependency-aware uptime with composite availability math
- Downtime attribution by dependency
- SLA composition analysis
- Availability trending month over month

---

## Theme F: Investigation & Lookup

_"Tell me exactly what happened to this one workflow."_

### F1. Lookup by business ID [P0, Primitive]

Preserved from rev 1 Cat 5. The single most impactful design decision for support response time.

**What's needed:**

- Lookup by business ID (order ID, customer ID, etc.)
- Full execution timeline — every step, wait, retry in order
- Input/output visibility per step
- Trigger source attribution
- Related workflows (parent/child, downstream)
- Query handlers — ask a running workflow what it's doing

### F2. Multi-criteria search & filtering [P1, Operational view]

Preserved from rev 1 Cat 6.

**What's needed:**

- Multi-criteria filtering (status AND time AND name AND custom fields)
- Custom search attributes for business-specific data
- Step-level filtering ("find workflows where step X failed")
- Aggregation (count by status, type, error category)
- Saved queries and reusable views

### F3. Replay & local reproduction [P2, Operational view]

Preserved from rev 1 Cat 17.

**What's needed:**

- Export execution history (inputs, step outputs, event history)
- Local replay against production history
- Replay compatibility testing for new code
- Step-through debugging

---

## Theme G: Operational Control

_"Act on workflows at scale and push updates out."_

### G1. Bulk operations [P1, Operational view]

Preserved from rev 1 Cat 7.

**What's needed:**

- Bulk cancel/terminate by query filter
- Bulk retry/resume matching criteria
- Bulk pause for maintenance
- Rate-limited execution
- Dry-run mode

### G2. Real-time notifications [P1, Primitive + Operational view]

Preserved from rev 1 Cat 18.

**What's needed:**

- Webhooks on lifecycle events (started, completed, failed, cancelled, stuck)
- Configurable channels (Slack, email, PagerDuty, custom)
- Event streaming subscriptions
- Selective subscriptions by type/status
- Real-time UI push updates without polling

---

## Theme H: Dependencies & Impact

_"If X breaks, what else breaks?"_

### H. Blast radius & dependency mapping [P1, Operational view]

Consolidates rev 1 Cat 14 (blast radius) with the dependency-mapping primitive that also underlies Theme E3 (effective availability). Same dependency graph, two use cases: reactive impact analysis and aggregate availability.

**What's needed:**

- Dependency mapping — which external services each workflow type calls
- Impact analysis — "service X is down → these 500 workflows affected"
- Parent-child visualization — full tree of workflow relationships
- Cross-workflow correlation by business transaction
- Proactive alerting on dependency degradation

---

## Theme I: Lifecycle & Scheduling

_"Did it run when it should have? Was the right version used?"_

### I1. Version distribution & deployment safety [P1, Operational view]

Preserved from rev 1 Cat 11.

**What's needed:**

- Version distribution visibility — workflows per code version
- Deployment safety checks for in-flight workflows
- Version-tagged filtering
- Replay compatibility testing
- Gradual migration tracking

### I2. Schedule execution & overlap [P1, Operational view]

Merges rev 1 Cat 16 (missed schedules) and Cat 24 (execution overlap). Both are scheduler-specific concerns and belong adjacent in any navigation.

**What's needed:**

- Missed schedule detection
- Schedule execution history
- Backfill tracking
- Schedule health dashboard (success/failure/missed rates)
- Overlap detection when a new run starts while the previous is still running
- Concurrent execution visibility
- Overlap prevention policies (skip, queue, kill-previous)
- Collision impact tracking

### I3. Data freshness & staleness [P2, Operational view]

Preserved from rev 1 Cat 22. Distinct from missed-schedule detection: a workflow may have run successfully and the output is still stale because it hasn't run _again_ recently enough.

**What's needed:**

- Freshness tracking per workflow output
- Freshness SLAs
- Staleness alerting
- Upstream propagation — "this asset is stale because its upstream is stale"
- Freshness dashboard

---

## Theme J: Throughput & Capacity

### J. Throughput & queue depth [P1, Primitive + Operational view]

Preserved from rev 1 Cat 19.

**What's needed:**

- Throughput metrics — workflows started/completed per second
- Queue depth and wait time
- Worker utilization
- Concurrency tracking
- Capacity forecasting
- Rate-limit visibility and backpressure signals

---

## Theme K: Resource Hygiene

### K. Resource leak / orphaned holds [P1, Operational view]

Preserved from rev 1 Cat 31. Distinct from B (failure attribution) and H (blast radius): this is about _resources the failed workflow itself held_ and didn't release.

**What's needed:**

- Orphaned resource detection — holds/locks/auths outliving their workflow
- TTL monitoring
- Cleanup verification after failure compensation
- Resource-leak trending
- Automatic-cleanup alerting when a hold should have been released

---

## Theme L: Compliance & Security (Cross-cutting)

These are constraints on how _all other_ observability is implemented, not separate observability capabilities. Treat them as requirements that every category must satisfy.

### L1. Audit trail [P2, Primitive]

Preserved from rev 1 Cat 12.

**What's needed:**

- User attribution for start/cancel/resume/modify
- Immutable execution history
- Retention policies
- Export for auditors
- Access control on observability data

### L2. PII protection in observability [P2, Cross-cutting constraint]

Reframed from rev 1 Cat 13. Not a standalone category — it's a constraint applied to payload handling in every other category.

**What's needed:**

- Payload redaction/masking of PII in inputs/outputs
- Role-based observability access (support vs engineer)
- Configurable data retention for sensitive fields
- Codec/encryption at rest
- Selective visibility — show step names and timing while hiding payload data

---

## Theme M: Cost Attribution

### M. Cost & resource attribution [P2, Derived metric]

Preserved from rev 1 Cat 15. Adjacent to observability but primarily a FinOps concern; included because workflow platforms expose unique cost dimensions (compute-vs-wait, LLM tokens) that general FinOps tools miss.

**What's needed:**

- Per-workflow cost attribution (compute, API calls, storage)
- Per-step cost breakdown
- Cost trends per workflow type
- Budget alerts
- Token/API-call tracking (especially AI agent workflows)

---

## Theme N: Integration with External Systems

### N. OTel, metrics export, and tooling integration [P1, Primitive]

Preserved from rev 1 Cat 8.

**What's needed:**

- OpenTelemetry integration with span links (not parent-child) for async causality
- Metrics export (Prometheus, StatsD, OTLP)
- Structured logs with workflow-ID correlation
- Webhook/event hooks on lifecycle events
- CDC/streaming export to data warehouses
- Replay-safe instrumentation (logs/metrics that don't duplicate on replay)

---

## Theme O: Derived Business Metrics

_Computed from primitives in other themes. Included for completeness but note these are not things to instrument — they are things to compute._

### O1. STP / automation rate [P2, Derived metric]

Preserved from rev 1 Cat 26. Computed from step-level error/intervention data (primitives in Theme B).

**What's needed:**

- Percentage of workflows completing without manual intervention
- Exception/fallout tracking by step
- STP trending
- Cost-of-intervention attribution

### O2. Workflow analytics & BI [P2, Derived metric]

Preserved from rev 1 Cat 35. Computed from step timing and status primitives (Themes B, C). Explicitly an analytics concern — different data model and different consumers than operational observability.

**What's needed:**

- Aggregate duration metrics grouped by business dimensions
- Cohort analysis across customer tiers, regions, product types
- Distribution visualization (histograms, percentile curves)
- Trend analysis by dimension
- Funnel analysis — drop-off at each stage

---

## Appendix: AI Agent Workflows

Rev 1 Cat 10 treated "AI agent observability" as a first-class category alongside workflow observability. On review, most of its concerns either (a) generalize from other themes or (b) are not workflow-specific at all. This appendix clarifies which is which.

| AI agent concern                                | Where it belongs                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| Tool call logging (inputs/outputs/latency)      | Theme B1 (step-level attribution) — tool calls are steps          |
| Loop detection                                  | Theme A1 (stuck / progress) — a loop is a progress signal failure |
| LLM cost / token tracking                       | Theme M (cost attribution)                                        |
| Human-in-the-loop tracking                      | Theme O1 (STP rate) and Theme B1                                  |
| Decision tracing (why the agent chose action X) | **Genuinely agent-specific** — not a workflow concern             |
| Hallucination / wrong-answer detection          | **Genuinely agent-specific** — not a workflow concern             |

Recommendation: keep LLM decision tracing and hallucination detection as an appendix (they need specialized tooling: LangSmith, Braintrust, etc.), and integrate the rest into the main themes with agent-specific examples.

---

## Priority-Ranked Summary

| Priority | Theme | Category                              | Tier        |
| -------- | ----- | ------------------------------------- | ----------- |
| **P0**   | A     | A1. Stuck detection & progress        | Operational |
| **P0**   | B     | B1. Step-level error attribution      | Primitive   |
| **P0**   | D     | D5. Safety invariant monitoring       | Primitive   |
| **P0**   | F     | F1. Lookup by business ID             | Primitive   |
| **P1**   | A     | A2. Workflow internal health          | Primitive   |
| **P1**   | C     | C1. Per-step duration & critical path | Primitive   |
| **P1**   | C     | C2. Compute vs wait time breakdown    | Primitive   |
| **P1**   | D     | D1. Output correctness & validation   | Operational |
| **P1**   | E     | E1. Per-workflow SLA                  | Derived     |
| **P1**   | E     | E2. Batch window forecast             | Derived     |
| **P1**   | E     | E3. Effective availability            | Derived     |
| **P1**   | F     | F2. Multi-criteria search             | Operational |
| **P1**   | G     | G1. Bulk operations                   | Operational |
| **P1**   | G     | G2. Real-time notifications           | Primitive   |
| **P1**   | H     | Blast radius & dependency mapping     | Operational |
| **P1**   | I     | I1. Version distribution              | Operational |
| **P1**   | I     | I2. Schedule execution & overlap      | Operational |
| **P1**   | J     | Throughput & queue depth              | Primitive   |
| **P1**   | K     | Resource leak detection               | Operational |
| **P1**   | N     | OTel & metrics export                 | Primitive   |
| **P2**   | B     | B2. Soft failures & degradation       | Operational |
| **P2**   | D     | D2. Schema & contract drift           | Operational |
| **P2**   | D     | D3. Cross-party reconciliation        | Operational |
| **P2**   | D     | D4. Desired vs actual convergence     | Operational |
| **P2**   | F     | F3. Replay & local reproduction       | Operational |
| **P2**   | I     | I3. Data freshness                    | Operational |
| **P2**   | L     | L1. Audit trail                       | Primitive   |
| **P2**   | L     | L2. PII protection (cross-cutting)    | Constraint  |
| **P2**   | M     | Cost attribution                      | Derived     |
| **P2**   | O     | O1. STP / automation rate             | Derived     |
| **P2**   | O     | O2. Workflow analytics / BI           | Derived     |

---

## Mapping from Rev 1 to Rev 2

| Rev 1 Category                      | Rev 2 Location                                   | Change                                                                 |
| ----------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| 1. What's happening right now       | A1                                               | Merged with 23                                                         |
| 2. Why did it fail                  | B1                                               | Merged with 21's partial-failure content                               |
| 3. Why is it slow                   | C1                                               | Merged with 21's critical-path content                                 |
| 4. Meeting SLAs                     | E1                                               | Preserved, regrouped under Theme E                                     |
| 5. What happened to this workflow   | F1                                               | Preserved                                                              |
| 6. Find workflows matching criteria | F2                                               | Preserved                                                              |
| 7. Bulk actions                     | G1                                               | Preserved                                                              |
| 8. External tool integration        | N                                                | Preserved                                                              |
| 9. Soft failures                    | B2                                               | Preserved                                                              |
| 10. AI agent-specific               | Appendix                                         | Decomposed across themes; only decision-tracing remains agent-specific |
| 11. Version safety                  | I1                                               | Preserved                                                              |
| 12. Audit / compliance              | L1                                               | Preserved, reframed as cross-cutting                                   |
| 13. PII protection                  | L2                                               | Reframed from category to cross-cutting constraint                     |
| 14. Blast radius                    | H                                                | Merged with 34's dependency-graph primitive                            |
| 15. Cost attribution                | M                                                | Preserved                                                              |
| 16. Missed schedules                | I2                                               | Merged with 24                                                         |
| 17. Replay locally                  | F3                                               | Preserved                                                              |
| 18. Real-time notifications         | G2                                               | Preserved                                                              |
| 19. Throughput & capacity           | J                                                | Preserved                                                              |
| 20. Output correctness              | D1                                               | Preserved, regrouped under Theme D                                     |
| 21. DAG execution path              | Split: B1 (partial failure) + C1 (critical path) | Decomposed                                                             |
| 22. Freshness                       | I3                                               | Preserved                                                              |
| 23. Progress / ETA                  | A1                                               | Merged with 1                                                          |
| 24. Execution overlap               | I2                                               | Merged with 16                                                         |
| 25. Batch window                    | E2                                               | Preserved                                                              |
| 26. STP rate                        | O1                                               | Preserved, flagged as derived metric                                   |
| 27. Reconciliation                  | D3                                               | Preserved                                                              |
| 28. Schema drift                    | D2                                               | Preserved                                                              |
| 29. Desired vs actual               | D4                                               | Preserved                                                              |
| 30. Safety invariants               | D5                                               | Preserved                                                              |
| 31. Resource leaks                  | K                                                | Preserved                                                              |
| 32. Workflow internal health        | A2                                               | Preserved                                                              |
| 33. Compute vs wait                 | C2                                               | Preserved                                                              |
| 34. Effective availability          | E3 + H                                           | Split across themes                                                    |
| 35. Workflow analytics / BI         | O2                                               | Preserved, flagged as derived metric                                   |

**Net:** 35 flat categories → 15 themes containing 31 categories + 1 cross-cutting constraint + 1 appendix.

---

## Key structural changes

1. **Themes group related concerns.** 15 themes provide navigation; the priority table still enumerates individual categories so nothing is lost.
2. **Primitive / Operational / Derived tiers are explicit.** Readers now know which items must be instrumented (primitives) vs which are computed on top (derived metrics).
3. **PII protection is a cross-cutting constraint, not a category.** Every theme implicitly inherits it.
4. **AI agent concerns are decomposed.** Most map to existing themes; only genuinely agent-specific items (decision tracing, hallucination detection) remain in an appendix.
5. **Overlapping categories merged:**
   - Stuck detection + progress tracking → A1
   - Step-level errors + partial branch failures → B1
   - Slow analysis + critical path → C1
   - Missed schedules + execution overlap → I2
   - Blast radius + dependency-aware uptime (share the same graph) → H + E3
6. **Explicit scope & non-goals** prevent future scope creep.
7. **Priorities are consistent** — P0 items are both high-impact and under-served by current platforms; P1 items are widely needed; P2 items are valuable but either niche or served by adjacent tooling.
