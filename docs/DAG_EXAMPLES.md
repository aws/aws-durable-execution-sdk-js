# DAG Examples (TypeScript)

> **Status:** Companion to [`DAG_SPEC.md`](./DAG_SPEC.md) (canonical design) · **Stability:** Experimental (tracks the DAG feature)
>
> Worked examples of `context.dag(...)`, each with the execution history it produces. Every snippet is typechecked against the SDK on this branch. Where behavior differs between SDKs it is called out; the normative cross-language rules live in [`DAG_SPEC_CROSS_LANGUAGE.md`](./DAG_SPEC_CROSS_LANGUAGE.md).

## Example 1 — A linear chain

Three steps, each depending on the one before.

```text
┌───────────┐   100    ┌──────────┐  "charged 100"  ┌──────────┐
│  reserve  │ ───────► │  charge  │ ──────────────► │  notify  │
└───────────┘          └──────────┘                 └──────────┘
   root                 reads deps.reserve           reads deps.charge
```

```ts
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

interface OrderEvent {
  orderId: string;
  amount: number;
}

export const handler = withDurableExecution(
  async (event: OrderEvent, context: DurableContext) => {
    // ── Declare the graph. Nothing runs yet: no registration, no checkpoint,
    //    no task bodies. `context.dag()` returns a lazy DurablePromise. ──
    const dagPromise = context.dag("order", (d) => {
      // Everything in this arrow function is the "register callback".
      // It only declares tasks.

      // A root task: no deps, so the callback keeps the native step shape.
      const reserve = d.step("reserve", [], async (): Promise<number> => {
        return event.amount;
      });

      // Declaring `reserve` as a dep gives you `deps.reserve`, typed number.
      const charge = d.step(
        "charge",
        [reserve],
        async (deps): Promise<string> => {
          return `charged ${deps.reserve}`;
        },
      );

      d.step("notify", [charge], async (deps): Promise<string> => {
        return `sent: ${deps.charge}`;
      });
    });

    // ── Run it. The await is what registers, validates, schedules and
    //    executes every task above. ──
    const dagResult = await dagPromise;

    return {
      reason: dagResult.completionReason,
      notify: dagResult.getResult("notify"),
      counts: [
        dagResult.successCount,
        dagResult.failureCount,
        dagResult.totalCount,
      ],
    };
  },
);
```

### The register callback

The second argument to `context.dag` — the `(d) => { … }` block — is the register callback. Its only job is to _register_ tasks, like filling in a form. Each `d.step(...)` call writes down "there is a task called X that depends on Y". Your step bodies do not run inside it.

That is why `d.step(...)` returns a **handle** rather than a value. `const reserve = d.step("reserve", …)` is a token meaning "the task named reserve", not the number `100`. Passing that token into a later task's deps array does two things at once: it creates the edge in the graph, and it puts a typed entry in that task's `deps` map, keyed by task name. At run time the SDK hands the task the real resolved value.

Two practical rules follow:

- The block must be **deterministic** — no `await`, no `Math.random()`, no `if (Date.now() …)` deciding which tasks exist. It re-runs on replay and the graph must come out the same each time.
- A task body can only see what it **declared**. `notify` gets `deps.charge`; it cannot reach `deps.reserve` without adding it to its deps array.

### When things actually run

The split between `dagPromise` and `await` is real, not stylistic. `context.dag()` returns a `DurablePromise`, which is lazy by design — it defers execution until awaited or chained. Between the two statements, nothing has been written to the execution history and no task body has run.

On `await dagPromise`, in this order:

1. **Config guards** — pure checks on `config` (e.g. `maxConcurrency <= 0` throws) run before anything durable is written.
2. **The DAG container is entered** — checkpoints `ContextStarted SubType=Dag`.
3. **The register callback runs** — your `(d) => { … }` block executes now, inside the container. Still no task bodies; only task definitions are recorded.
4. **The graph is validated** — cycles, duplicate names, dependencies on tasks from another DAG, task-name charset. A bad graph throws here, at the await.
5. **The scheduler runs** — it launches every task whose deps have all settled, up to `maxConcurrency`, checkpointing each as its own operation. **This is where your step bodies finally run.** It keeps going until the graph drains.
6. **The container closes** — `ContextSucceeded SubType=Dag`, and the await returns the `DagResult`.

So the child operations run in step 5, driven by the scheduler — not by you awaiting them individually. You never await a task handle; you await the DAG and it runs the tasks for you. `reserve` starts immediately because it has no deps, `charge` when `reserve` has succeeded, `notify` when `charge` has.

One cross-language wrinkle, because it changes where errors surface: **Java registers and validates eagerly at the `dag(...)` call site**, before entering the child context. That is deliberate — a graph-validation error then reaches the caller as a typed `Dag*Exception` instead of being erased into a generic `ChildContextFailedException` at the child-context boundary. JS validates inside the container instead and keeps the typed error intact with an `errorMapper: (e) => e` pass-through.

### Why the return types are annotated

`async (): Promise<number>` is deliberate, not style. The task callbacks are typed through a conditional type, which TypeScript cannot use as an inference site for the result type — so without the annotation `TResult` widens to `unknown` and `deps.reserve` becomes unusable. Annotate the callback's return type, or pin the type arguments.

### What gets checkpointed

```text
ExecutionStarted
└── ContextStarted   SubType=Dag  Name=order        id: 1
    ├── StepStarted   SubType=Step  Name=reserve    id: 1-DAG_NODE_T_reserve
    ├── StepSucceeded SubType=Step  Name=reserve    → 100
    ├── StepStarted   SubType=Step  Name=charge     id: 1-DAG_NODE_T_charge
    ├── StepSucceeded SubType=Step  Name=charge     → "charged 100"
    ├── StepStarted   SubType=Step  Name=notify     id: 1-DAG_NODE_T_notify
    ├── StepSucceeded SubType=Step  Name=notify     → "sent: charged 100"
    └── ContextSucceeded  SubType=Dag  Name=order
InvocationCompleted
ExecutionSucceeded
```

The DAG itself is **one** operation: a container with subtype `Dag`, whose ID comes from the enclosing handler's operation counter (`1` here, if it is the first operation in your handler).

Every task is checkpointed **directly inside** that container as its _native_ operation type — a step task is just a `Step`, with no per-task wrapper. Three tasks plus the container is four operations: N+1. That matters because a single execution has a ceiling of 3,000 operations, and a wrapper-per-task design would cost 2N+1.

Task IDs are derived from the task **name**, not from a counter: `{containerId}-DAG_NODE_T_{name}`. This is the central design decision. A counter would be fragile, because a DAG legitimately runs its ready tasks in different orders across invocations — concurrency, retries, resumes — so counter-assigned IDs would not line up on replay. Name-derived IDs always do. On the wire the pre-images are hashed, so you would actually see `Id: dace6e26094653f7` rather than the readable form above.

Replay then works per task. If `charge` is already checkpointed as `SUCCEEDED`, the SDK returns its stored result and never calls your function again. So if `notify` fails and the invocation retries, `reserve` and `charge` are free — no recomputation, no duplicate side effects.

## Example 2 — Fan-out and fan-in

The shape you actually use a DAG for: two independent branches off one root, merged by a task that reads both.

```text
        ┌──────────┐
        │   load   │  root: no deps
        └────┬─────┘
             │ 10
      ┌──────┴──────┐
      ▼             ▼
┌───────────┐ ┌───────────┐
│   usage   │ │  billing  │  independent → run concurrently
│ load * 3  │ │ load + 5  │
└─────┬─────┘ └─────┬─────┘
      │ 30          │ 15
      └──────┬──────┘
             ▼
      ┌─────────────┐
      │   summary   │  fan-in: reads deps.usage + deps.billing
      └─────────────┘
        "usage=30 billing=15"
```

```ts
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

interface ReportEvent {
  customerId: string;
}

export const handler = withDurableExecution(
  async (event: ReportEvent, context: DurableContext) => {
    const dagPromise = context.dag("report", (d) => {
      const load = d.step("load", [], async (): Promise<number> => {
        return 10;
      });

      // Both depend only on `load`, so nothing orders them relative to
      // each other: the scheduler starts both as soon as `load` succeeds.
      const usage = d.step("usage", [load], async (deps): Promise<number> => {
        return deps.load * 3;
      });

      const billing = d.step(
        "billing",
        [load],
        async (deps): Promise<number> => {
          return deps.load + 5;
        },
      );

      // Fan-in: two deps, so `deps` carries both, each typed and keyed by name.
      d.step("summary", [usage, billing], async (deps): Promise<string> => {
        return `usage=${deps.usage} billing=${deps.billing}`;
      });
    });

    const dagResult = await dagPromise;

    return {
      reason: dagResult.completionReason,
      summary: dagResult.getResult("summary"),
      statuses: {
        usage: dagResult.getStatus("usage"),
        billing: dagResult.getStatus("billing"),
      },
    };
  },
);
```

### What's new here

**Concurrency is a consequence of the graph, not a call you make.** `usage` and `billing` both list only `load`, so they have no ordering relationship — the scheduler starts both the moment `load` settles. Compare this with example 1, where the chain forced strict sequencing. You did not write `Promise.all`; you wrote down dependencies and the scheduler derived the parallelism.

**`deps` is a map, not a list.** `summary` declares `[usage, billing]` and reads `deps.usage` and `deps.billing` — keyed by task name, each with its own type (`number` here). Order in the array does not matter to the body.

**You can cap the width.** Add a config argument to bound how many tasks run at once:

```ts
context.dag("report", (d) => { … }, { maxConcurrency: 1 });
```

With `maxConcurrency: 1` this same graph runs strictly sequentially in topological order — which is how the conformance scenarios pin down a deterministic history. Leave it unset for unlimited.

### What gets checkpointed

```text
ExecutionStarted
└── ContextStarted   SubType=Dag  Name=report        id: 1
    ├── StepStarted   SubType=Step  Name=load        id: 1-DAG_NODE_T_load
    ├── StepSucceeded SubType=Step  Name=load        → 10
    ├── StepStarted   SubType=Step  Name=usage       id: 1-DAG_NODE_T_usage     ┐ both in
    ├── StepStarted   SubType=Step  Name=billing     id: 1-DAG_NODE_T_billing   ┘ flight
    ├── StepSucceeded SubType=Step  Name=billing     → 15
    ├── StepSucceeded SubType=Step  Name=usage       → 30
    ├── StepStarted   SubType=Step  Name=summary     id: 1-DAG_NODE_T_summary
    ├── StepSucceeded SubType=Step  Name=summary     → "usage=30 billing=15"
    └── ContextSucceeded  SubType=Dag  Name=report
InvocationCompleted
ExecutionSucceeded
```

Still flat and still N+1: four tasks plus the container is five operations.

The interleaving is the point. Both `StepStarted` events land before either `StepSucceeded`, and `billing` finishes before `usage` here purely because it happened to be quicker. On a retry the order could differ — and this is precisely why task IDs are name-derived rather than counter-assigned. A counter would hand out `-1`, `-2` in completion order, which varies between invocations; `1-DAG_NODE_T_usage` is stable no matter who wins the race.

That stability is what makes partial progress safe. If `summary` throws and the invocation retries, the SDK finds `load`, `usage` and `billing` already checkpointed as `SUCCEEDED`, returns their stored results, and only re-runs `summary`.

## Example 3 — Failure, compensation, and skips

A failed task is a normal terminal state, not an abort. That single decision is what makes sagas expressible.

```text
              ┌──────────┐
              │  charge  │  root — throws "payment declined"
              └────┬─────┘
                   │ FAILED
      ┌────────────┼────────────┐
      ▼            ▼            ▼
┌───────────┐ ┌──────────┐ ┌──────────┐
│   ship    │ │  refund  │ │  audit   │
│ALL_SUCCESS│ │ALL_FAILED│ │ ALL_DONE │  ← trigger rules
└───────────┘ └──────────┘ └──────────┘
   SKIPPED      "refunded"    "logged"
   no events
```

```ts
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const dagPromise = context.dag("checkout", (d) => {
      const charge = d.step("charge", [], async (): Promise<string> => {
        throw new Error("payment declined");
      });

      // Default trigger rule is ALL_SUCCESS, so an upstream failure SKIPS this.
      d.step("ship", [charge], async (deps): Promise<string> => {
        return `shipped after ${deps.charge}`;
      });

      // Compensation: runs only because `charge` failed.
      d.step("refund", [], async (): Promise<string> => "refunded")
        .after(charge)
        .triggerRule("ALL_FAILED");

      // Runs either way — the audit trail should not care how it went.
      d.step("audit", [], async (): Promise<string> => "logged")
        .after(charge)
        .triggerRule("ALL_DONE");
    });

    const dagResult = await dagPromise;

    return {
      reason: dagResult.completionReason,
      statuses: {
        charge: dagResult.getStatus("charge"),
        ship: dagResult.getStatus("ship"),
        refund: dagResult.getStatus("refund"),
        audit: dagResult.getStatus("audit"),
      },
      counts: [
        dagResult.successCount,
        dagResult.failureCount,
        dagResult.skippedCount,
        dagResult.totalCount,
      ],
    };
  },
);
```

### What's new here

**The DAG does not throw.** `charge` fails, yet `await dagPromise` resolves. You get a `DagResult` whose `completionReason` is `COMPLETED_WITH_FAILURES` and whose `failureCount` is 1. This is the pivot: if a failure aborted the graph, a compensating task downstream of that failure could never be scheduled. Call `dagResult.throwIfError()` if you want the throwing behavior at a point of your choosing.

**Trigger rules decide whether a task runs, based on its upstream _statuses_.** The default is `ALL_SUCCESS`, which is why `ship` is skipped. `refund` uses `ALL_FAILED`, so it runs exactly in the case you want a refund. `audit` uses `ALL_DONE`, so it runs either way. There are six rules: `ALL_SUCCESS`, `ALL_FAILED`, `ALL_DONE`, `ANY_SUCCESS`, `ANY_FAILED`, `NONE_FAILED`.

**`.after(x)` is an ordering-only edge; `[x]` is a data edge.** `refund` and `audit` pass an empty deps array and use `.after(charge)`, so they wait for `charge` and see its status, but get no `deps.charge` value — appropriate, since a failed task has no result to read. `ship` declares `[charge]` because it genuinely wants the value. Use `.after()` when you need sequencing without data.

**A skipped task is free.** `ship` emits no events at all. It is not "run and discarded" — it never starts, so it costs nothing against the operation budget. Skips also cascade: anything downstream of `ship` with the default rule would skip too.

### What gets checkpointed

```text
ExecutionStarted
└── ContextStarted   SubType=Dag  Name=checkout       id: 1
    ├── StepStarted   SubType=Step  Name=charge       id: 1-DAG_NODE_T_charge
    ├── StepFailed    SubType=Step  Name=charge       ✗ "payment declined"
    │                                                   (after retries are exhausted)
    │   … ship: SKIPPED — no events whatsoever
    ├── StepStarted   SubType=Step  Name=refund       id: 1-DAG_NODE_T_refund
    ├── StepSucceeded SubType=Step  Name=refund       → "refunded"
    ├── StepStarted   SubType=Step  Name=audit        id: 1-DAG_NODE_T_audit
    ├── StepSucceeded SubType=Step  Name=audit        → "logged"
    └── ContextSucceeded  SubType=Dag  Name=checkout
InvocationCompleted
ExecutionSucceeded
```

Note the last two lines: the container **succeeds** and the execution **succeeds**, even though a task inside failed. The DAG's job was to drain the graph and report, and it did.

Two details from real histories. `charge` exhausts the default retry policy before `StepFailed` — a step task's retry behavior inside a DAG is exactly the standalone step's, so with the default policy the failure lands in a later invocation after backoff. And the returned counts here are `[2, 1, 1, 4]`: two succeeded, one failed, one skipped, four registered. `totalCount` counts what you _registered_, not what ran.

## Example 4 — Value-based branching with `runIf`

Trigger rules look at upstream _statuses_. `runIf` looks at upstream _values_. Together they give you a switch statement over a graph.

```text
                 ┌──────────┐
                 │  triage  │  root → "manual"
                 └────┬─────┘
                      │ value
      ┌───────────────┼────────────────┐
      ▼               ▼                ▼
┌───────────────┐ ┌───────────────┐ ┌───────────┐
│ autoApprove   │ │ manualReview  │ │  reject   │
│runIf =="auto" │ │runIf=="manual"│ │=="reject" │
└──────┬────────┘ └──────┬────────┘ └────┬──────┘
    SKIPPED           SUCCEEDED       SKIPPED
       └────────────────┼────────────────┘
                        ▼
                 ┌─────────────┐
                 │    close    │  ANY_SUCCESS
                 └─────────────┘
```

```ts
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

interface ClaimEvent {
  claimId: string;
}

export const handler = withDurableExecution(
  async (event: ClaimEvent, context: DurableContext) => {
    const dagPromise = context.dag("claim", (d) => {
      // Returns one of "auto" | "manual" | "reject".
      const triage = d.step("triage", [], async (): Promise<string> => {
        return "manual";
      });

      // Three mutually exclusive branches. `runIf` is a plain synchronous
      // predicate over the resolved deps — no await, no side effects.
      const auto = d.step(
        "autoApprove",
        [triage],
        async (): Promise<string> => "approved automatically",
        { runIf: (deps) => deps.triage === "auto" },
      );

      const manual = d.step(
        "manualReview",
        [triage],
        async (): Promise<string> => "queued for an adjuster",
        { runIf: (deps) => deps.triage === "manual" },
      );

      const reject = d.step(
        "reject",
        [triage],
        async (): Promise<string> => "rejected",
        { runIf: (deps) => deps.triage === "reject" },
      );

      // Whichever branch ran, close the claim. ANY_SUCCESS tolerates the two
      // skipped siblings; the default ALL_SUCCESS would skip this too.
      d.step("close", [], async (): Promise<string> => "closed")
        .after(auto, manual, reject)
        .triggerRule("ANY_SUCCESS");
    });

    const dagResult = await dagPromise;

    return {
      reason: dagResult.completionReason,
      taken: ["autoApprove", "manualReview", "reject"].find(
        (name) => dagResult.getStatus(name) === "SUCCEEDED",
      ),
      close: dagResult.getResult("close"),
      counts: [
        dagResult.successCount,
        dagResult.skippedCount,
        dagResult.totalCount,
      ],
    };
  },
);
```

### What's new here

**`runIf` is a gate on data, evaluated by the scheduler.** It receives the same typed `deps` map the body would, and returns a boolean. `false` means the task is skipped with `skipReason: "RUN_IF_PREDICATE"` — again, no events, no cost. The predicate must be **synchronous and deterministic**: no `async`, no IO, no clock. It is re-evaluated on replay and has to reach the same verdict, and it is not a checkpointed operation, so anything it does is not durable.

**`runIf` and trigger rules compose, in that order.** A task runs only if its trigger rule is satisfied _and_ its `runIf` returns true. Trigger rule first (do I like my upstreams' statuses?), then `runIf` (do I like their values?).

**`ANY_SUCCESS` is what makes an exclusive fan-in work.** `close` waits on all three branches, but two of them skipped. Under the default `ALL_SUCCESS` a skipped upstream is not a success, so `close` would skip as well and the graph would quietly do nothing at the end. `ANY_SUCCESS` says "at least one worked, that is enough".

**This is a genuine branch, not a filtered result.** The two untaken branches never execute. Contrast with computing all three and discarding two: here you pay nothing for the paths not taken, which is the point when a branch is an expensive API call.

### What gets checkpointed

```text
ExecutionStarted
└── ContextStarted   SubType=Dag  Name=claim          id: 1
    ├── StepStarted   SubType=Step  Name=triage       id: 1-DAG_NODE_T_triage
    ├── StepSucceeded SubType=Step  Name=triage       → "manual"
    │   … autoApprove: SKIPPED (RUN_IF_PREDICATE) — no events
    ├── StepStarted   SubType=Step  Name=manualReview id: 1-DAG_NODE_T_manualReview
    ├── StepSucceeded SubType=Step  Name=manualReview → "queued for an adjuster"
    │   … reject:      SKIPPED (RUN_IF_PREDICATE) — no events
    ├── StepStarted   SubType=Step  Name=close        id: 1-DAG_NODE_T_close
    ├── StepSucceeded SubType=Step  Name=close        → "closed"
    └── ContextSucceeded  SubType=Dag  Name=claim
InvocationCompleted
ExecutionSucceeded
```

Five registered tasks, three operations plus the container. Counts come back `[3, 2, 5]`: three succeeded, two skipped, five registered — and `completionReason` is `ALL_COMPLETED`, because skipping is not failing.

The history is also the reason the determinism rule on `runIf` is strict. Nothing in the checkpoint record says "autoApprove was skipped" — absence is the encoding. On replay the scheduler re-derives that decision by evaluating the predicate again, so a predicate that flip-flops would make the SDK expect a task it never finds, or find one it did not expect.
