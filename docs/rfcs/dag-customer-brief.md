# DAG Support for durable executions - Customer Brief

## What customers are asking for

Customers building workflow orchestration with the durable execution SDK
have repeatedly asked for a declarative way to define task graphs with
dependencies. The need surfaces in two distinct customer behaviors:

**Direct asks**: customers describe their workflows as graphs and ask for
DAG semantics by name. They want to declare "task C runs after tasks A and
B," let parallelism happen automatically where possible, and have the
runtime handle scheduling.

**Indirect asks via friction**: a larger group of customers surfaces the
same need by reporting friction with current primitives. They attempt to
build DAGs using `Promise.all` chains, multiple `runInChildContext` blocks,
or sequences of `parallel`/`map` operations, and run into limitations they
can't easily work around.

The same pattern appears in adjacent products. AWS Step Functions
customers have asked for richer DAG semantics — conditional task
execution, easier expression of fan-out/fan-in with heterogeneous tasks,
better dependency declaration. The underlying customer need is shared:
**a declarative way to express task graphs with dependencies, with the
runtime handling scheduling, parallelism, and conditional execution.**

### Concrete customer scenarios

These are the workflow shapes customers actually build:

**Multi-stage data pipelines**: fetch from multiple sources in parallel,
transform each independently, merge results, validate, publish. Today's
options force customers to either serialize the parallel stages
unnecessarily or write fragile manual `Promise.all` orchestration.

**Validation rules engines**: a graph of validation rules with
dependencies — some rules are independent and can run in parallel, others
depend on intermediate results. Some rules are terminal (a definitive
rejection). Customers want the runtime to handle scheduling and produce
detailed per-rule results.

**Parallel branches with different dependencies**: branch A depends on
results from steps 1 and 2; branch B depends on results from steps 1 and 3. Branch A and B run in parallel where possible. Today this requires
careful manual orchestration with multiple `runInChildContext` blocks.

## Why the current SDK can't deliver this well

The durable execution SDK today provides building blocks: `step`,
`runInChildContext`, `parallel`, `map`, `Promise.all`. These compose for
simple patterns. They break down for arbitrary DAGs in three ways.

### 1. Replay correctness breaks for non-trivial graphs

The SDK assigns each operation a unique entity ID using a per-context
monotonic counter. Operations get IDs in the order they start. This works
for `parallel` and `map` because items always start in deterministic
array order. It breaks for arbitrary DAGs where downstream tasks start
based on upstream completion order — completion order can vary across
replays, so entity IDs diverge, and replay validation fails.

### 2. Parallelism is sacrificed for serializability

To work around the replay issue, customers serialize their DAGs:
`Promise.all` barriers between every layer of the graph, even when
parallelism would be safe. This loses the performance benefits the
customer wanted in the first place.

### 3. Conditional execution is awkward

Today's `parallel` and `map` only support homogeneous independent
branches. Conditional execution (e.g., "run task X only if task Y
returned status 'safe'") requires either:

- Throwing exceptions for business decisions (conflates failures with
  outcomes)
- Running all downstream tasks and having them check upstream results
  internally (wasteful, reduces parallelism)
- Using external state to coordinate (defeats the purpose of durable
  execution)

## What we deliver to customers

DAG support is a first-class primitive for declaring task graphs with
dependencies. Customers describe their workflow once; the runtime handles
scheduling, parallelism, ordering, and conditional execution.

The capabilities customers gain:

- **Declarative graphs with typed data flow**: customers describe what
  depends on what — when task C depends on tasks A and B, C's function
  receives A and B's outputs as typed inputs. No manual handle juggling,
  no `any`-typed payloads, no `Promise.all` choreography.

- **Replay-safe by construction**: the runtime guarantees replay works
  regardless of graph shape, completion order, or execution timing. No
  "works by accident" patterns that silently break as the graph grows.

- **Maximum natural parallelism**: tasks with independent dependency
  chains run concurrently; tasks with shared dependencies wait for the
  right inputs and start as soon as possible.

- **Per-task execution policies**: each task can have its own retry
  strategy, runtime conditional skip (`runIf` based on upstream
  results), and trigger rule (run on all success, all failed, all done,
  etc.) — useful for compensation paths and fallback logic.

- **Heterogeneous task types**: any durable execution operation can be a
  task — `step`, `invoke`, `callback`, `wait`, `runInChildContext`,
  `map`, `parallel` — not just homogeneous functions.

- **Nested DAGs**: group related tasks into a sub-DAG that the parent
  treats as a single unit, useful for reusable pipelines and logical
  organization.

- **Cycle detection**: errors at workflow start time if dependencies
  form a cycle, instead of hanging at runtime.

- **Observability**: each task appears in the execution history as a
  distinct, named operation. Task names are stable across runs (not
  order-dependent), making debugging straightforward.

### What a DAG workflow looks like

A payment flow with conditional fulfillment, compensation on failure,
and an audit log that always runs:

```typescript
await context.dag("payment-flow", async (dagCtx) => {
  // Charge the customer
  const charge = dagCtx.step("charge", [], async () => chargeCard(event));

  // Fulfill order — default ALL_SUCCESS, only runs if charge succeeded
  const fulfill = dagCtx.step("fulfill", [charge], async (deps) =>
    shipOrder(deps.charge),
  );

  // Fraud alert — only for high-value charges that succeeded (runIf)
  const alert = dagCtx.step(
    "fraud-alert",
    [charge],
    async (deps) => notifyFraudTeam(deps.charge),
    { runIf: (deps) => deps.charge.amount > 1000 },
  );

  // Refund — runs only if charge failed (triggerRule)
  const refund = dagCtx
    .step("refund", [], async () => refundCard(event))
    .deps(charge)
    .triggerRule("ALL_FAILED");

  // Audit log — runs regardless of outcome, after every other task
  dagCtx
    .step("audit", [], async () => writeAuditLog(event))
    .deps(fulfill, alert, refund)
    .triggerRule("ALL_DONE");
});
```

In this graph:

- `charge` runs first (no dependencies)
- `fulfill` and `alert` both depend on `charge` and run in parallel when
  `charge` succeeds
- `alert` is further gated by `runIf` — it skips if the amount is small
- `refund` runs only if `charge` fails, replacing the success path
- `audit` runs after the entire workflow regardless of which path
  executed, useful for compliance logging

### What this enables in customer workflows

Customers can express the patterns from the scenarios above directly:

- **ETL pipelines** become a graph: each fetch is a task, each transform
  is a task, the merge is a task with dependencies. The runtime
  parallelizes everything that can run independently.
- **Rules engines** become a DAG: each rule is a task. Independent rules
  run in parallel; dependent rules wait for upstream rules; conditional
  rules are skipped when their predicate fails.
- **Compensation flows** are expressed as tasks with `triggerRule:
ALL_FAILED` for compensation paths and `triggerRule: ALL_DONE` for
  notification tasks that run regardless of outcome.
- **Conditional routing** uses per-task `runIf` predicates to gate
  downstream tasks based on upstream return values.

## Why this matters

DAG support unblocks a class of workflows that customers want to build
but currently can't build well. The customers most affected are exactly
the ones the durable execution SDK is designed for: long-running,
multi-step, stateful workflows where reliability and observability
matter.

Without DAG support, these customers either accept significantly less
parallelism than their workflow naturally allows, write fragile manual
orchestration that breaks subtly, or move to alternative platforms.
With DAG support, they get a primitive that matches the shape of their
problem.

The change is purely additive. Existing customers continue using `step`,
`parallel`, `map`, and the other primitives unchanged. DAG support is
opt-in: customers reach for it when their workflow is graph-shaped, and
ignore it when it isn't.
