# Workflow Observability Requirements

A comprehensive catalog of what engineers need to observe about workflow execution in production, organized by theme and priority.

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
- Generic AI/LLM observability unrelated to workflow execution (see Appendix for the workflow-specific slice)
- Business analytics unrelated to workflow execution patterns

---

## Theme A: Liveness & Progress

_"Is this workflow alive and moving forward?"_

### A1. Stuck detection & progress tracking [P0, Operational view]

A workflow sitting in RUNNING state for 7 hours with no errors, no latency spikes, and all dashboards green — while the customer's order hasn't moved — is the most commonly reported observability gap. Workflow engines often report "healthy" while individual workflows stall waiting on signals, timers, or dependencies. Separately, when a workflow has been running for 2 hours, engineers need to know whether it's 10% done or 90% done, not just that it's alive.

Progress is not one signal but three, each requiring different instrumentation and answering different questions:

1. **Step-boundary progress** — time since the last step completed or a new step started. Answers: "list all workflows that have made no step transition in the past 2 hours." Catches workflows idle between steps (waiting on a signal, timer, callback, or child workflow that never arrived). Needs only step-transition timestamps.
2. **In-flight progress** — signals emitted by currently executing work. The source depends on what's running:
   - **For steps** (synchronous units of work that execute and return): steps do not emit heartbeats. In-flight progress is inferred from **retry / attempt counts** and per-attempt timing. Answers: "this step is on attempt 7 and has been retrying for 30 minutes" or "this step has been on attempt 1 longer than its p95 attempt duration." A step that is executing but going nowhere shows up as an unusually long single attempt or a climbing retry count.
   - **For callbacks** (async operations waiting for external completion — long-running jobs, external APIs, human approvals): callbacks emit **heartbeats** carrying application-level counters. Answers: "this callback is alive and has processed 73,000 of 100,000 records" or "this callback hasn't heartbeat in 10 minutes — is the external worker dead?"
3. **Workflow-lifetime progress** — total elapsed time vs expected duration for this workflow type. Answers: "this workflow usually completes in 10 minutes, this one is at 2 hours." Catches outliers at the workflow level regardless of where the delay sits. Requires per-workflow-type expected duration metadata.

All three are "stuck detection" but they surface different failure modes. A workflow idle between steps for 2 hours will never be caught by an in-flight check (nothing is running). A step stuck in an infinite loop will never be caught by a step-boundary check (the step is still "active") and has no heartbeat to miss — only its attempt duration exceeding p95 reveals it. A callback that crashes silently is caught by heartbeat absence, not by retry counts.

**Primitives required:** step start/end timestamps with attempt numbers, callback heartbeats with application-level counters, expected-duration metadata per workflow type, per step, and per callback.

**What's needed:**

- Real-time count of workflows by status (running, queued, failed, stuck)
- **Step-boundary stall detection** — filter workflows whose last step transition was more than N minutes ago (e.g., "no forward step progress in 2 hours")
- **Step-level stall detection via attempts** — step attempt duration exceeds p95/p99 for that step, or retry count exceeds threshold
- **Callback stall detection via heartbeats** — callback has not heartbeat within its expected interval
- **Workflow-lifetime stall detection** — total duration exceeds the p95/p99 for this workflow type
- Progress percentage and ETA during in-flight execution (from callback heartbeats where available)
- Throughput rate for callbacks (items processed per second/minute from heartbeat counters)
- Items processed vs total (e.g., "73,000 of 100,000 records") — from callback heartbeat payloads
- Queue depth and backlog monitoring
- Progress history — is callback throughput stable, increasing, or degrading?
- Structured heartbeat data on callbacks — not just "alive" but "alive and making progress at X rate"

### A2. Workflow internal health [P1, Primitive + Operational view]

When a workflow is long-lived (especially the workflow-as-scheduler pattern where the workflow itself is a sleep-loop that fires work periodically), the workflow instance becomes a resource that can degrade over time. Event history grows with every iteration. Replay time increases. Memory climbs. Eventually the workflow hits platform limits and is forcibly terminated — silently killing your "scheduler."

This is distinct from business progress (A1): the workflow isn't stuck, it's running but degrading from the engine's perspective.

**What's needed:**

- Event history size monitoring — how many events, approaching platform limits?
- Replay duration tracking — how long to replay this workflow on a new worker, and is it getting slower?
- Worker memory per workflow
- `continueAsNew` tracking — when was the last reset, how many iterations since?
- Workflow age monitoring
- Platform limit proximity alerts (history size, timeout, retention)

---

## Theme B: Failure Attribution

_"Why did it fail, and where exactly?"_

### B1. Step-level error attribution [P0, Primitive + Operational view]

A workflow that runs for hours or days can get 9 steps out of 10 and still leave a mess: half-created records, confusing status, and no clear next action. Engineers need to pinpoint the exact step that failed, see the error, and understand the workflow's state at that moment — not just "workflow failed."

This is equally critical in parallel branches: workflows may continue to downstream steps if a failed step was not declared a dependency, silently marking the step as failed while other parallel branches complete normally. Traditional observability often falls short with parallel pipeline executions, leading to gaps that obscure root causes.

**Primitives required:** per-step error records with inputs/outputs, retry history, stack traces, branch/path identifiers for parallel execution.

**What's needed:**

- Which specific step failed and why
- Error context — inputs, outputs, and state at point of failure
- Retry history — how many attempts, what errors on each attempt
- Failure categorization — transient vs permanent, infrastructure vs business logic
- Stack traces for code-level debugging
- Per-branch status in fan-out/fan-in patterns — alert when some branches fail even if the overall workflow "succeeds"
- Conditional path tracking — which if/else branch was taken and why
- Execution path visualization — which branches ran, which were skipped, which failed

### B2. Soft failures & degradation signals [P2, Operational view]

The most dangerous failures are the ones that don't look like failures. A step that retries 3 times and succeeds is "successful" — but the retry pattern is an early warning signal. A gateway returning TIMEOUT on 20% of auth attempts but succeeding on immediate retry looks perfectly healthy from the workflow engine's perspective. The rising retry frequency is the degradation signal you can act on before it becomes a failure rate.

**What's needed:**

- Retry rate tracking per step and per workflow type over time
- Soft error categorization — transient errors that were handled but indicate degradation
- Success-with-retries vs clean-success distinction
- Downstream health inference from retry patterns
- Data quality validation — workflow succeeded but output was wrong/incomplete

---

## Theme C: Performance

_"Why is it slow, and where is the time going?"_

### C1. Per-step duration & bottleneck analysis [P1, Primitive + Operational view]

Workflow execution duration metrics typically measure internal engine overhead, not business outcome time. Platform-level metrics tell you the engine is healthy. They don't tell you that your payment step went from 200ms to 8 seconds because a downstream API is degrading.

In workflows with parallel branches, conditional paths, or fan-out/fan-in patterns, knowing _which_ path determined total duration is essential — optimizing the wrong branch has no effect on wall-clock time.

**What's needed:**

- Per-step duration tracking (start and end time for every step)
- Duration trends over time — p50/p95/p99 per step, per workflow type
- Anomaly detection — "this step is 10x slower than its 7-day average"
- Bottleneck identification — which step contributes most to total workflow duration
- Critical path analysis — which sequence of steps determined total wall-clock duration
- Downstream dependency correlation — slow step → slow external API

### C2. Compute vs wait time breakdown [P1, Primitive]

Durable execution workflows have a unique compute pattern: they alternate between **active compute** (running step code) and **suspended/idle** (waiting for timers, callbacks, child workflows, signals). Wall-clock duration tells you almost nothing about actual resource consumption. A workflow that runs for 30 days may only use 45 seconds of compute.

When a wait completes, there's also a hidden delay before the workflow actually resumes execution — history replay, rehydration, worker scheduling. This "resume latency" is invisible to standard duration metrics but directly affects user-facing responsiveness.

**What's needed:**

- Compute time vs wall-clock time breakdown per workflow and per step
- Resume latency tracking — time from "event received" to "code executing" after each suspend
- Replay/rehydration overhead — how much of resume time is replaying history vs executing new code
- Suspend/resume frequency — how often this workflow cycles between active and idle
- Idle cost verification — confirm you're not billed for suspended time on pay-per-compute platforms

---

## Theme D: Correctness

_"Execution succeeded, but was the outcome actually right?"_

A shared theme across this section: **execution status ≠ correctness.** Workflow platforms universally track execution status (running / succeeded / failed) and universally fail to track whether the outcome was correct. A step that returns an empty array is "successful." A workflow that processes 0 of 10,000 records is "complete." The status is green. The result is wrong.

### D1. Output correctness & validation [P1, Operational view]

The pipeline succeeded. The data was wrong. No one knew until a human noticed. This is the cost of monitoring pipeline execution without monitoring pipeline output. A pipeline that fails loudly is the best kind of problem — the dangerous pipeline is the one that succeeds silently while delivering wrong data.

**What's needed:**

- Output assertions — validate step outputs against expected schemas, ranges, or counts
- Anomaly detection on outputs — "this step usually returns 10K rows, today it returned 3"
- Business rule validation — "order total should never be negative"
- Comparison with previous runs — "output differs significantly from last successful run"
- Silent failure alerting — detect when a step "succeeds" but produces empty/invalid results

### D2. Schema & contract drift [P2, Operational view]

An upstream API adds a new field. A column is removed from the source table. A data type changes from string to integer. The workflow may still "succeed" but produce garbage because it's processing data shaped differently than expected. In ETL, this is one of the most common causes of silent data corruption.

**What's needed:**

- Schema change detection — alert when input/output schema differs from expected
- Schema versioning and evolution tracking
- Contract validation — verify inputs match a declared schema/contract before processing
- Impact analysis — "this schema changed → these workflows and downstream consumers are affected"
- Backward compatibility checks — is the new schema compatible with existing workflow code

### D3. Cross-party reconciliation [P2, Operational view]

When a workflow interacts with external parties (payment processors, APIs, counterparties, partner systems), the workflow's view of what happened may not match the external party's view. Trade "breaks" — mismatches in trade details — occur due to data entry errors, system latency, counterparty discrepancies, or market anomalies. This is distinct from internal output validation: reconciliation is about cross-system agreement.

**What's needed:**

- Match rate monitoring — what percentage of transactions match across systems
- Break/mismatch detection between internal and external records
- Break aging — how long have unresolved mismatches been outstanding
- Field-level mismatch detail — which specific fields don't agree
- Reconciliation dashboard — at-a-glance view of matched vs unmatched vs in-progress

### D4. Desired vs actual state convergence [P2, Operational view]

When a workflow sends a command to external systems (IoT device updates, deployment rollouts, configuration changes, feature flag updates, infrastructure provisioning), "the workflow succeeded" means the command was sent — not that the target actually converged to the desired state. The gap between desired state (what the workflow wants) and reported state (what the target says it is), and how long that gap persists, is a critical observability signal.

**What's needed:**

- Convergence rate — what percentage of targets have reached desired state
- Convergence time — how long between command sent and state confirmed
- Non-converged target identification — which specific targets haven't applied the change
- Divergence alerting — alert when desired ≠ actual for longer than threshold
- Rollout progress tracking — "7,342 of 10,000 devices updated (73.4%)"

### D5. Safety invariant monitoring [P0, Primitive + Operational view]

In traffic lights, two conflicting green signals = collision. In railway interlocking, two trains in the same block section = disaster. In financial systems, a negative balance or double-spend = regulatory violation. These are invariants that must never be violated, not even for a millisecond.

This is fundamentally different from output correctness (checked after completion) — safety invariant monitoring must be **continuous during execution** and violations must be detected and acted on immediately. It applies to any workflow with hard constraints: financial limits, compliance rules, resource caps, mutual exclusion, ordering guarantees.

**What's needed:**

- Continuous invariant checking — validate constraints at every state transition, not just at completion
- Immediate violation alerting when a constraint is breached
- Proof of compliance — auditable evidence that invariants were maintained throughout execution
- Degraded mode tracking — when the system enters a reduced-capability safe state, track why and for how long
- Conflict detection — identify when two concurrent workflows would violate a mutual exclusion constraint

---

## Theme E: SLAs & Commitments

_"Are we meeting the promises we made?"_

Three flavors of the same core question, differing by scope: per-workflow (E1), group-deadline (E2), and composite-availability (E3).

### E1. Per-workflow SLA [P1, Derived metric]

Business stakeholders care about outcomes, not infrastructure health. "All green" means nothing if 5% of orders are stuck. SLAs need to be measured in business time (customer-visible completion) rather than engine time (how long the platform took to process events).

**What's needed:**

- End-to-end workflow duration (business time, not engine time)
- SLA breach detection and alerting — workflow exceeded expected completion time
- Completion rate by workflow type — success/failure/timeout percentages
- Trend dashboards — are things getting better or worse?
- Business-tagged metrics — by customer tier, region, workflow type

### E2. Batch window / processing deadline [P1, Derived metric]

Mainframe batch systems have tracked this for decades: batch jobs often must complete within a window (a period of less-intensive online activity) prescribed by an SLA. The question isn't "will this one workflow finish on time?" but "will ALL the workflows in this processing window finish before the deadline?" A single slow job can blow the window for everything downstream. Modern workflow platforms largely ignore this concept.

**What's needed:**

- Window completion forecast — given current progress, will all jobs finish before the deadline?
- Critical chain identification — which sequence of dependent jobs determines the window end time?
- Window utilization trending — is the batch window getting tighter over time? (growing data volumes)
- Rerun impact analysis — if this job needs to rerun, does the window still fit?
- Window breach alerting — early warning when the window is at risk, not just when it's already blown

### E3. Effective availability / dependency-aware uptime [P1, Derived metric]

A workflow's **effective availability** is not the workflow engine's uptime. It's the intersection of every dependency's availability. If your workflow calls a payment API (99.9%), a shipping API (99.5%), and a notification service (99.8%), your workflow's theoretical max availability is ~98.2% — even if your own code and infrastructure are perfect.

Most teams discover this the hard way: the workflow engine dashboard shows 100% uptime, but customers report 2% of orders failing. The failures are all caused by downstream services, but nobody tracks the workflow's effective uptime as a composite metric.

**What's needed:**

- Effective workflow availability — success rate of this workflow type over time (not engine uptime, but actual completion rate)
- Dependency-aware uptime — map each workflow type to its dependencies and compute composite availability
- Downtime attribution — "47 minutes of workflow downtime this month: 30 min from payment API, 12 min from shipping API, 5 min from our code"
- Dependency health impact — "payment API degradation caused 342 workflow failures today"
- SLA composition — "given our dependencies' published SLAs, the best we can promise is 98.5%"
- Availability trending — is our effective uptime improving or degrading month over month?

---

## Theme F: Investigation & Lookup

_"Tell me exactly what happened to this one workflow."_

### F1. Lookup by business ID [P0, Primitive]

When a support ticket arrives about order 98765, the workflow ID is already known. Open the dashboard, paste order-98765, and the full execution timeline should appear in front of you in ten seconds. That single design decision — deterministic, readable workflow IDs and lookup by business attributes — is the difference between a five-minute diagnosis and a twenty-minute one.

**What's needed:**

- Lookup by business ID — find workflow by order ID, customer ID, etc.
- Full execution timeline — every step, every wait, every retry, in order
- Input/output visibility — what data went in, what came out
- Trigger source — API call, cron, event, manual
- Related workflows — parent/child relationships, downstream effects
- Query handlers — ask the running workflow "what are you doing right now?"

### F2. Multi-criteria search & filtering [P1, Operational view]

Most platforms only support basic filtering (status + time range). Engineers need to filter by business-specific criteria, step-level state, and custom attributes — for example, "find all workflows where step X failed" or "all workflows for customer Y triggered by this event."

**What's needed:**

- Multi-criteria filtering — status AND time AND name AND custom fields
- Custom search attributes — filter by business-specific data (customer ID, order amount, region)
- Step-level filtering — "find all workflows where step X failed" (very few platforms support this)
- Aggregation — count by status, by type, by error category
- Saved queries / views — reusable filters for common investigations

### F3. Replay & local reproduction [P2, Operational view]

Durable execution platforms record execution history for replay/recovery. But that same history is rarely exposed in a way that lets engineers reproduce issues locally. Engineers need to re-run a production workflow's exact history against local code to debug issues and verify fixes.

**What's needed:**

- Export execution history — download inputs, step outputs, and event history
- Local replay — re-run a production workflow's history against local code
- Replay compatibility testing — verify new code replays correctly against old histories
- Step-through debugging — walk through execution history step by step

---

## Theme G: Operational Control

_"Act on workflows at scale and push updates out."_

### G1. Bulk operations [P1, Operational view]

When an upstream service goes down and 10,000 workflows are stuck, you need to act on all of them at once — not one by one. Incident responders need to cancel, retry, pause, or terminate workflows in bulk based on query filters.

**What's needed:**

- Bulk cancel/terminate — by query filter
- Bulk retry/resume — restart failed workflows matching criteria
- Bulk pause — hold workflows during maintenance
- Rate-limited bulk operations — don't overwhelm the system
- Dry-run mode — "show me what would be affected" before acting

### G2. Real-time notifications [P1, Primitive + Operational view]

Polling for status is wasteful and introduces latency. Engineers and systems need to be **pushed** updates when workflow state changes. This is also how workflow platforms integrate with incident-response tools (PagerDuty, Slack) and customer-facing UIs without building a custom polling layer.

**What's needed:**

- Webhooks on lifecycle events — started, completed, failed, cancelled, stuck
- Configurable notification channels — Slack, email, PagerDuty, custom webhook
- Event streaming — subscribe to a real-time stream of workflow events
- Selective subscriptions — only notify for specific workflow types or statuses
- UI push updates — real-time status in dashboards without polling

---

## Theme H: Dependencies & Impact

_"If X breaks, what else breaks?"_

### H. Blast radius & dependency mapping [P1, Operational view]

Workflows orchestrate multiple services. When one dependency fails, you need to instantly understand which workflows are impacted. The same underlying dependency graph also powers the composite availability math in Theme E3 — it's one primitive, two use cases: reactive impact analysis and aggregate availability forecasting.

**What's needed:**

- Dependency mapping — which external services/APIs each workflow type calls
- Impact analysis — "service X is down → these 500 workflows are affected"
- Parent-child visualization — full tree of workflow relationships
- Cross-workflow correlation — group related workflows by business transaction
- Proactive alerting — "dependency X is degrading, these workflow types will be affected"

---

## Theme I: Lifecycle & Scheduling

_"Did it run when it should have? Was the right version used? Is the output still fresh?"_

### I1. Version distribution & deployment safety [P1, Operational view]

Long-running workflows may run for days or weeks. Deploying new code while old workflows are mid-execution can cause replay failures, non-determinism errors, or silent data corruption. Version safety is a correctness concern, not just a metadata concern.

**What's needed:**

- Version distribution visibility — how many workflows are running on each code version
- Deployment safety checks — "are there in-flight workflows that would break with this deploy?"
- Version-tagged filtering — find all workflows running on version X
- Replay compatibility testing — verify new code can replay old workflow histories
- Gradual migration tracking — monitor old-version workflows draining before decommissioning

### I2. Schedule execution & overlap [P1, Operational view]

Scheduled workflows have two distinct failure modes that are easy to miss. First, **missed schedules:** cron doesn't care if your job succeeds or fails — it just runs the command and moves on. A scheduled workflow that silently fails to fire is invisible because there's no error — nothing happened. Second, **execution overlap:** when a task takes longer to finish than the interval between scheduled runs, multiple instances operate concurrently, potentially causing duplicate writes, resource clashes, or data corruption.

**What's needed:**

- Missed schedule detection — alert when an expected run didn't happen
- Schedule execution history — did each scheduled slot produce a run?
- Backfill tracking — which missed runs were backfilled, which are still pending
- Schedule health dashboard — success/failure/missed rates per schedule
- Overlap detection — alert when a new run starts while the previous is still executing
- Concurrent execution visibility — how many instances of the same workflow are running simultaneously
- Overlap prevention policies — skip, queue, or kill-previous when overlap detected
- Collision impact tracking — did the overlap cause duplicate writes or data corruption

### I3. Data freshness & staleness [P2, Operational view]

This is distinct from missed-schedule detection. Freshness is about **timeliness**: the workflow ran and succeeded, but the data it produced is now stale because it hasn't run again. Dashboards may show out-of-date data while all workflows report "healthy."

**What's needed:**

- Freshness tracking per output — when was each workflow output last updated
- Freshness SLAs — "this data must be refreshed every hour"
- Staleness alerting — notify when data exceeds freshness threshold
- Upstream propagation — "this asset is stale because its upstream dependency is stale"
- Freshness dashboard — at-a-glance view of which outputs are fresh vs stale

---

## Theme J: Throughput & Capacity

### J. Throughput & queue depth [P1, Primitive + Operational view]

Workflow platforms abstract away infrastructure, but someone still needs to know if the system is keeping up with demand. Queue growth that outpaces worker drain rate is the leading indicator of impending SLA breaches.

**What's needed:**

- Throughput metrics — workflows started/completed per second
- Queue depth and wait time — how long workflows sit before starting
- Worker utilization — are workers busy or idle
- Concurrency tracking — how many workflows running simultaneously
- Capacity forecasting — at current growth rate, when do we hit limits
- Rate limit visibility — are downstream rate limits causing backpressure

---

## Theme K: Resource Hygiene

### K. Resource leak / orphaned holds [P1, Operational view]

When a workflow creates a **temporary resource hold** (seat reservation, payment authorization, inventory lock, database lock, cloud resource) and then fails, times out, or crashes before completing or cleaning up, the resource is "leaked." It's neither used nor freed. Over time these orphaned holds accumulate: seats appear sold but aren't, payment auths expire and confuse reconciliation, inventory shows unavailable but nobody has it.

This is distinct from failure attribution (the workflow failure is known; the leaked resource is the hidden side effect) and from blast radius (this is about resources the workflow itself held, not downstream services it affected).

**What's needed:**

- Orphaned resource detection — find holds/locks/auths that outlived their workflow
- TTL monitoring — track temporary holds approaching or past their expiry
- Cleanup verification — confirm that failed workflow compensations actually released resources
- Resource leak trending — are orphaned holds accumulating over time?
- Automatic cleanup alerting — notify when a hold should have been released but wasn't

---

## Theme L: Compliance & Security (Cross-cutting)

These are constraints on how _all other_ observability is implemented, not separate observability capabilities. Treat them as requirements that every category must satisfy.

### L1. Audit trail [P2, Primitive]

In regulated industries (healthcare, finance, government), workflow execution history is a compliance requirement, not a nice-to-have. An operator must be able to answer: what happened, why, what evidence was used, and who approved it.

**What's needed:**

- User attribution — who started, cancelled, resumed, or modified each workflow
- Immutable execution history — tamper-proof record of every step and decision
- Retention policies — keep audit data for required compliance periods
- Export capabilities — extract execution records for auditors
- Access control on observability data — who can see workflow inputs/outputs (may contain PII)

### L2. PII protection in observability [P2, Cross-cutting constraint]

Workflow inputs and outputs often contain customer data, payment info, or health records. Full observability conflicts with data protection requirements. This is not a standalone category — it's a constraint applied to payload handling in every other category.

**What's needed:**

- Payload redaction/masking — automatically mask PII in inputs/outputs before storing
- Role-based observability access — support sees status but not payloads; engineers see everything
- Configurable data retention — auto-delete sensitive data after N days
- Codec/encryption support — encrypt payloads at rest in the observability store
- Selective visibility — show step names and timing but hide step data

---

## Theme M: Cost Attribution

### M. Cost & resource attribution [P2, Derived metric]

Workflow execution waste — compute spend driven by how inefficiently work executes — doesn't get its own line item on the bill and doesn't trigger anomaly alerts. It sits inside existing compute costs, looking normal. As workflow volume scales, cost attribution becomes critical. Without it, runaway workflows or inefficient steps silently inflate cloud bills.

This is adjacent to observability — primarily a FinOps concern — but included because workflow platforms expose unique cost dimensions (compute-vs-wait time, LLM tokens, per-step costs) that general FinOps tools miss.

**What's needed:**

- Per-workflow cost attribution — compute time, API calls, storage used
- Per-step cost breakdown — which steps are most expensive
- Cost trends — is this workflow type getting more expensive over time
- Budget alerts — notify when a workflow type exceeds cost threshold
- Token/API call tracking — especially for AI agent workflows (LLM costs)

---

## Theme N: Integration with External Systems

### N. OTel, metrics export, and tooling integration [P1, Primitive]

Workflows are asynchronous and long-running. Traditional request/response tracing doesn't work. The trace from the HTTP request that started the workflow ends at `workflow.start()` — everything the workflow does is orphaned in a disconnected trace tree. Proper async tracing requires span **links** (for causality across boundaries) rather than parent-child relationships. Instrumentation must also be replay-safe so logs and metrics don't duplicate when a workflow replays its history.

**What's needed:**

- OpenTelemetry integration — traces with proper span links (not parent-child) for async causality
- Metrics export — Prometheus / StatsD / OTLP for custom dashboards
- Log aggregation — structured logs with workflow ID correlation
- Webhook/event hooks — notify external systems on lifecycle events
- CDC/streaming export — raw data to data warehouses for analytics
- Replay-safe instrumentation — logs and metrics that don't duplicate on workflow replay

---

## Theme O: Derived Business Metrics

Computed from primitives in other themes. Included for completeness but note these are not things to instrument directly — they are things to compute on top of instrumented data.

### O1. STP / automation rate [P2, Derived metric]

In trading and financial services, the **STP rate** (Straight-Through Processing rate) is the single most important operational metric: what percentage of transactions flow end-to-end without a human touching them? The global average STP rate for cross-border payments is around 26%. Every manual intervention is cost, delay, and risk. This concept applies broadly to any workflow system: what's your automation rate, and where do workflows "fall out" to manual handling?

**What's needed:**

- STP / automation rate — percentage of workflows completing without manual intervention
- Exception/fallout tracking — which workflows needed human repair and why
- Fallout by step — which step causes the most manual interventions
- STP rate trending — is automation improving or degrading over time
- Cost of manual intervention — time and money spent on exception handling

### O2. Workflow analytics & BI [P2, Derived metric]

Operational observability answers "is this workflow healthy right now?" Business intelligence answers "what are the patterns across thousands of executions over time?" These are fundamentally different questions requiring different data models and different consumers. No workflow platform provides aggregate analytics grouped by business dimensions out of the box — you can filter by status and time range, but you can't ask "average duration of completed workflows grouped by claim_type where region = 'EU'" without building a custom analytics pipeline.

**What's needed:**

- Aggregate duration metrics — average, median, p95, p99 grouped by workflow type, outcome, or custom dimensions
- Business dimension grouping — slice metrics by customer tier, region, product type, outcome, or any business attribute
- Cohort analysis — compare performance across groups (e.g., "claims from channel A take 2x longer than channel B")
- Distribution visualization — histograms, percentile curves, not just averages
- Trend analysis by dimension — "rejected claims are getting faster but accepted claims are getting slower — why?"
- Funnel analysis — what percentage of workflows reach each stage, and where do they drop off?

---

## Appendix: AI Agent Workflows

AI agents introduce non-deterministic behavior on top of workflow execution. Traditional "did it succeed or fail?" is insufficient — you need to understand the reasoning chain. Agents fail quietly: the agent completes its run, returns a response, and everything looks fine — until you realize it called the wrong tool three times, hallucinated a parameter value, and the task was never actually done.

Most agent observability concerns are not workflow-specific and map to existing themes:

| AI agent concern                                    | Where it belongs                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| Tool call logging (inputs, outputs, latency)        | Theme B1 — tool calls are steps; same primitive                            |
| Loop detection (agent stuck retrying)               | Theme A1 — a loop is a progress-signal failure                             |
| LLM cost / token tracking                           | Theme M — cost attribution with an extra dimension                         |
| Human-in-the-loop tracking (approvals, escalations) | Theme O1 (STP rate) and Theme B1                                           |
| Decision tracing — why the agent chose action X     | **Genuinely agent-specific** — specialized tooling (LangSmith, Braintrust) |
| Hallucination / wrong-answer detection              | **Genuinely agent-specific** — specialized tooling                         |

For workflow platforms hosting AI agents: ensure tool calls, retries, and human-approval steps appear as first-class steps in the step-level attribution (B1) so agent execution is fully visible in the standard workflow observability surface. Layer agent-specific tooling (decision tracing, hallucination detection) on top.

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

**Key heuristic:** P0 items are both high-impact and under-served by current workflow platforms. P1 items are widely needed across production deployments. P2 items are valuable but either niche, served by adjacent tooling, or derived from P0/P1 primitives.

---

## Sources

This document synthesizes requirements from production workflow platforms, community incident reports, and domain-specific observability practices:

- **Workflow-as-code platforms:** Temporal community forums, Xgrid's "Temporal Observability in Production" guide, SigNoz Temporal analysis, Restate, DBOS, Cloudflare Workflows, AWS Lambda Durable, Azure Durable, Inngest
- **DAG orchestrators:** Airflow (Astronomer, Orchestra), Dagster (freshness policies), Prefect, Argo Workflows (Waldium on parallel-branch blind spots)
- **Long-running and batch systems:** Spring Batch, OneUpTime on checkpointing, Appmaster on long-running workflow visibility
- **CI/CD and microservices:** GitHub Actions discussions, saga/microservice orchestration patterns
- **Data pipelines and ETL:** DataLakehouse.help and Ryan Kirsch on silent pipeline failures, DQOps on schema drift, data observability five pillars (CDP.com, Dawiso, Actian, Conduktor)
- **Financial services:** Wise and IBM on STP rates, Ionixx and Corvair on post-trade reconciliation, TechStory on high-volume observability, Finantrix on trade matching
- **Mainframe batch processing:** IBM z/OS on batch windows, BMC on system monitoring, Broadcom CA Workload Automation, Planet Mainframe, FlyRiver on DRT (Daily Run Time)
- **IoT and fleet management:** Azure IoT Hub device twins, Golioth on desired-vs-actual patterns, Memfault and Bosch IoT Rollouts
- **Safety-critical systems:** Railway signaling principles, arc42 Quality Model on fail-safe defaults, Risknowlogy on IEC 61508 graceful degradation
- **Booking and reservations:** Ajit Singh on ticket booking design (seat locks, TTL), ODown on travel platform reliability, BugFree.ai on airline reservation state
- **Compliance and security:** Grail on AI workflow audit trails, Hoop.dev on PII redaction in debugging
- **Cost and resource:** Vantage on workflow execution waste, DBOS on Lambda compute-vs-wait billing
- **Cron and scheduling:** OnlineOrNot / Crontify on missed schedule detection, YiluProxy and BigData Republic on execution overlap
- **AI agents:** Braintrust, Maxim AI, Neuronex, The AI University on agent observability patterns
- **Cross-cutting:** AutonomOps on blast radius, FlowWright on observability beyond monitoring, FlyRiver on queue monitoring, Orkes/Conductor on workflow versioning, Inngest on durable execution latency

---

## Service types covered

This document draws on observability practices from a broad range of execution systems:

- Workflow-as-code platforms (Temporal, Restate, DBOS, Cloudflare, AWS Lambda Durable, Azure Durable, Vercel)
- DAG orchestrators (Airflow, Dagster, Prefect, Argo Workflows)
- Long-running batch jobs and background tasks
- CI/CD pipelines (GitHub Actions, Jenkins)
- Microservice orchestration and sagas
- AI agent workflows (multi-step, tool-calling, LLM-based)
- Serverless functions (Lambda, Cloudflare Workers)
- State machines (AWS Step Functions)
- Message queue consumers (Kafka, SQS)
- Payment and transaction processing
- ML training pipelines (SageMaker, MLflow)
- IoT device command pipelines and fleet management
- Scheduled and cron-driven services
- API gateways and request orchestration
- Database migrations
- Approval and ticketing systems
- Mainframe batch processing (JCL, JES, CICS, TWS, CA-7, Control-M)
- Trading systems (pre-trade, post-trade, settlement)
- ETL and data pipelines
- Real-time and event-driven services
- Multimedia processing (transcoding, image processing, speech-to-text)
- Traffic control and railway signaling (safety-critical)
- Booking and reservation systems (airline, hotel, event)
- Healthcare and clinical systems (lab results, medication admin, handoffs)
- Workflow-as-scheduler patterns (sleep loops, `continueAsNew`)
- Durable execution compute lifecycles (suspend/resume, pay-per-compute)
