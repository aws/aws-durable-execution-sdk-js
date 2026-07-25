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

## Example 5 — A task that is not a step: `map`

Every example so far used `d.step`. But a task can be _any_ durable operation. Here one node in the graph is a `map` that fans out over a list.

```text
        ┌────────────┐
        │  accounts  │  root → [101, 102, 103]
        └─────┬──────┘
              │ items
              ▼
    ┌──────────────────────┐
    │         bill         │  ONE task, SubType=Map
    │ ┌─────┐┌─────┐┌─────┐│  fans out internally, maxConcurrency 2
    │ │ 101 ││ 102 ││ 103 ││
    │ └─────┘└─────┘└─────┘│
    └──────────┬───────────┘
               │ BatchResult<number>
               ▼
        ┌────────────┐
        │   total    │  3060
        └────────────┘
```

```ts
import {
  DurableContext,
  withDurableExecution,
  BatchResult,
} from "@aws/durable-execution-sdk-js";

interface InvoiceEvent {
  month: string;
}

export const handler = withDurableExecution(
  async (event: InvoiceEvent, context: DurableContext) => {
    const dagPromise = context.dag("invoices", (d) => {
      const accounts = d.step("accounts", [], async (): Promise<number[]> => {
        return [101, 102, 103];
      });

      // A map TASK: one node in the graph, but it fans out over the items.
      // The item body gets a real DurableContext, so each item can run its
      // own durable operations.
      const bill = d.map(
        "bill",
        [accounts],
        (deps) => deps.accounts,
        async (ctx: DurableContext, accountId: number): Promise<number> =>
          ctx.step(async (): Promise<number> => accountId * 10),
        { maxConcurrency: 2 },
      );

      // The map task's result is a BatchResult, not a plain array.
      d.step("total", [bill], async (deps): Promise<number> => {
        const batch = deps.bill as BatchResult<number>;
        return batch.getResults().reduce((acc, n) => acc + n, 0);
      });
    });

    const dagResult = await dagPromise;

    return {
      reason: dagResult.completionReason,
      total: dagResult.getResult("total"),
    };
  },
);
```

### What's new here

**A task delegates to the same operation handler the equivalent `context` method uses.** `d.map(...)` runs the SDK's real `map` operation — same retry semantics, same serdes, same batch completion behavior. The only difference from `context.map(...)` is that its entity ID comes from the task name instead of the context counter. There is no DAG-specific reimplementation of map, and the same holds for `invoke`, `callback`, `wait`, `waitForCondition`, `runInChildContext`, `parallel`, and a nested `dag`.

**The item list can be computed from deps.** The third argument accepts either a literal array or a function of the resolved deps — here `(deps) => deps.accounts`. That is how a map task fans out over something the previous task discovered.

**Two levels of concurrency, independently controlled.** `maxConcurrency: 2` in the map config limits items _within_ the task; a `maxConcurrency` on the DAG config limits how many _tasks_ run at once. They do not interact.

**The result is a `BatchResult`, not an array.** It carries per-item status alongside values, so a partial failure is expressible: `getResults()` for the successful values, plus counts. The cast is needed because `deps.bill` widens to `unknown` — the same result-type inference limitation noted in example 1.

**The item body gets a full `DurableContext`.** `ctx.step(...)` inside it is a real, separately checkpointed operation. You can nest further work per item rather than being limited to a pure function.

### What gets checkpointed

This is the first example where a task is _not_ flat — a map task is a container, so its items nest underneath it:

```text
ExecutionStarted
└── ContextStarted   SubType=Dag  Name=invoices        id: 1
    ├── StepStarted   SubType=Step  Name=accounts      id: 1-DAG_NODE_T_accounts
    ├── StepSucceeded SubType=Step  Name=accounts      → [101,102,103]
    ├── ContextStarted SubType=Map  Name=bill          id: 1-DAG_NODE_T_bill
    │   ├── ContextStarted   SubType=MapIteration      id: 1-DAG_NODE_T_bill-1
    │   │   ├── StepStarted   SubType=Step
    │   │   └── StepSucceeded SubType=Step             → 1010
    │   ├── ContextSucceeded SubType=MapIteration      → 1010
    │   ├── ContextStarted   SubType=MapIteration      id: 1-DAG_NODE_T_bill-2
    │   │   └── … → 1020
    │   ├── ContextStarted   SubType=MapIteration      id: 1-DAG_NODE_T_bill-3
    │   │   └── … → 1030
    │   └── ContextSucceeded SubType=Map  Name=bill
    ├── StepStarted   SubType=Step  Name=total         id: 1-DAG_NODE_T_total
    ├── StepSucceeded SubType=Step  Name=total         → 3060
    └── ContextSucceeded  SubType=Dag  Name=invoices
InvocationCompleted
ExecutionSucceeded
```

The important detail is the ID scheme at the boundary. The map container gets the **name-derived** task ID `1-DAG_NODE_T_bill`, but its iterations go back to **counter-based** IDs _within_ that container: `-1`, `-2`, `-3`. That is correct and deliberate — inside a map, item order is deterministic (array index), so a counter is safe there. Name-derivation is only needed at the DAG layer, where ready-task order genuinely varies. Task IDs are name-based; everything below a task is business as usual.

The N+1 accounting is per DAG layer, not a global promise: three tasks give you three operations under the container, and whatever the map's own items cost is the normal cost of a map.

## Example 6 — A nested sub-DAG

A task can be an entire DAG. This is how you compose reusable pieces of a workflow, and it is where task-name scoping starts to matter.

```text
        ┌────────────┐
        │  validate  │  outer root
        └─────┬──────┘
              ▼
   ┌─────────────────────────────────┐
   │   provision   SubType=Dag       │  ONE outer task…
   │                                 │
   │   ┌──────────┐    ┌──────────┐  │  …that is a whole graph
   │   │ database │───►│ validate │  │  ← same name as an outer task,
   │   └──────────┘    └──────────┘  │    different scope
   └─────────────┬───────────────────┘
                 │ DagResult
                 ▼
          ┌────────────┐
          │  welcome   │
          └────────────┘
```

```ts
import {
  DurableContext,
  withDurableExecution,
  DagResult,
} from "@aws/durable-execution-sdk-js";

interface OnboardEvent {
  tenantId: string;
}

export const handler = withDurableExecution(
  async (event: OnboardEvent, context: DurableContext) => {
    const dagPromise = context.dag("onboard", (d) => {
      const validate = d.step("validate", [], async (): Promise<string> => {
        return event.tenantId;
      });

      // A task that is itself a whole DAG. Its own tasks live in their own
      // scope: names inside cannot collide with, or depend on, names outside.
      const provision = d.dag("provision", [validate], (nd) => {
        const database = nd.step("database", [], async (): Promise<string> => {
          return "db-ready";
        });

        // Same name as a task in the OUTER graph — legal, different scope.
        nd.step("validate", [database], async (deps): Promise<string> => {
          return `checked ${deps.database}`;
        });
      });

      d.step("welcome", [provision], async (deps): Promise<string> => {
        const nested = deps.provision as DagResult;
        return `provisioned: ${nested.getResult("validate") as string}`;
      });
    });

    const dagResult = await dagPromise;

    return {
      reason: dagResult.completionReason,
      welcome: dagResult.getResult("welcome"),
      nestedReason: (dagResult.getResult("provision") as DagResult)
        .completionReason,
    };
  },
);
```

### What's new here

**Scope isolation.** The inner graph gets its own `DagContext` (`nd`), its own name space, and its own validation pass. That is why `validate` can exist in both graphs without colliding. The flip side is enforced too: an inner task cannot declare a dependency on an outer handle, and vice versa — that is a `DagInvalidDependencyError` at registration, not a runtime surprise. The two graphs communicate only through the sub-DAG task's result.

**A nested DAG resolves; it does not throw.** The sub-DAG's result is a full `DagResult`, so `welcome` can inspect per-task statuses, counts, and its own `completionReason`. If a task _inside_ `provision` fails, `provision` still resolves — with `failureCount > 0` — and the outer graph sees it as a _succeeded_ task. That is usually surprising the first time. If you want an inner failure to fail the outer task, call `throwIfError()` on the nested result, or check its counts and throw.

**Registration-time errors surface unwrapped.** A nested DAG wires a pass-through error mapper on its own container, so a validation error from the inner `register` — a cycle, a duplicate name, a bad name — reaches you as the typed `Dag*Error`, not as a generic `ChildContextError`. That is a deliberate exception to how other container failures are wrapped.

**Each level has its own concurrency.** `maxConcurrency` on the outer config bounds outer tasks; the nested `d.dag(..., config)` takes its own. An outer slot stays occupied for as long as the whole sub-DAG runs.

### What gets checkpointed

```text
ExecutionStarted
└── ContextStarted   SubType=Dag  Name=onboard          id: 1
    ├── StepStarted   SubType=Step  Name=validate       id: 1-DAG_NODE_T_validate
    ├── StepSucceeded SubType=Step  Name=validate       → "tenant-42"
    ├── ContextStarted SubType=Dag  Name=provision      id: 1-DAG_NODE_T_provision
    │   ├── StepStarted   SubType=Step Name=database    id: 1-DAG_NODE_T_provision-DAG_NODE_T_database
    │   ├── StepSucceeded SubType=Step Name=database    → "db-ready"
    │   ├── StepStarted   SubType=Step Name=validate    id: 1-DAG_NODE_T_provision-DAG_NODE_T_validate
    │   ├── StepSucceeded SubType=Step Name=validate    → "checked db-ready"
    │   └── ContextSucceeded SubType=Dag Name=provision
    ├── StepStarted   SubType=Step  Name=welcome        id: 1-DAG_NODE_T_welcome
    ├── StepSucceeded SubType=Step  Name=welcome        → "provisioned: checked db-ready"
    └── ContextSucceeded  SubType=Dag  Name=onboard
InvocationCompleted
ExecutionSucceeded
```

Two things to notice.

`SubType=Dag` appears **twice** — the nested container is a DAG, so it is checkpointed as one. This sounds obvious and was nonetheless a real bug: Java tagged nested DAGs as `RunInChildContext`, which conformance scenario 10-9 caught. It is now a normative cross-language rule (`DAG_SPEC_CROSS_LANGUAGE.md` §2.A.5).

The ID scheme composes. Where a map's items fell back to counters (example 5), a nested DAG's tasks stay name-derived — one `DAG_NODE_T_` segment per level: `1-DAG_NODE_T_provision-DAG_NODE_T_validate`. That is what keeps the two `validate` tasks distinct on the wire, and it is why task names are restricted to `^[a-zA-Z0-9_]+$` with `DAG_NODE_T_` reserved: dashes and the reserved token are what make this composition unambiguously parseable.

## Example 7 — Suspend and resume: `invoke`, `callback`, `wait`

The three task kinds that stop the invocation entirely. The DAG survives across invocations; you are not billed for compute while it waits.

```text
   ┌──────────┐
   │  submit  │  step
   └────┬─────┘
        ▼
   ┌──────────┐
   │  score   │  invoke   ─ ─ ─► suspends until the target function returns
   └────┬─────┘
        ▼
   ┌──────────┐
   │ approval │  callback ─ ─ ─► suspends until an external system answers
   └────┬─────┘                  (minutes, hours, days)
        ▼
   ┌──────────┐
   │ cooldown │  wait     ─ ─ ─► suspends for 30s, no compute billed
   └────┬─────┘
        ▼
   ┌──────────┐
   │  settle  │  step
   └──────────┘
```

```ts
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

interface ExpenseEvent {
  reportId: string;
  amount: number;
}

export const handler = withDurableExecution(
  async (event: ExpenseEvent, context: DurableContext) => {
    const reviewerFn = process.env.REVIEWER_FUNCTION_NAME!;

    const dagPromise = context.dag("expense", (d) => {
      const submit = d.step("submit", [], async (): Promise<number> => {
        return event.amount;
      });

      // invoke task: calls another durable function and suspends until it
      // returns. deps feed the payload function.
      const score = d.invoke<"score", [typeof submit], number, number>(
        "score",
        reviewerFn,
        [submit],
        (deps) => deps.submit,
      );

      // callback task: suspends until an external system completes it.
      // The submitter receives the callback id — hand it to whoever will
      // answer (an email, a ticket, a queue message).
      const approval = d.callback<"approval", [typeof score], string>(
        "approval",
        [score],
        async (callbackId) => {
          console.log(`awaiting approval, token=${callbackId}`);
        },
      );

      // wait task: a durable timer, no compute billed while it sleeps.
      const cooldown = d.wait("cooldown", [], { seconds: 30 }).after(approval);

      d.step("settle", [approval], async (deps): Promise<string> => {
        return `settled with ${deps.approval}`;
      }).after(cooldown);
    });

    const dagResult = await dagPromise;

    return {
      reason: dagResult.completionReason,
      settle: dagResult.getResult("settle"),
    };
  },
);
```

### What's new here

**Suspension is not the DAG's concern.** Each of these three kinds already knows how to suspend as a standalone operation, and a task delegates to that same handler. The scheduler's contribution is simply to not lose the rest of the graph: when the invocation stops, everything already settled stays checkpointed, and on resume the scheduler rebuilds its state from those checkpoints and continues.

**Other branches keep running.** Nothing here is single-file — if this graph had an independent branch alongside `approval`, it would keep making progress while `approval` waits. Suspension happens when there is nothing left to do but wait.

**`invoke` needs explicit type arguments.** `d.invoke<"score", [typeof submit], number, number>` spells out name, deps, payload type and result type. Unlike a step, the result type cannot be inferred from a payload function, so it must be pinned — otherwise it widens to `unknown`.

**The callback submitter is where you hand out the token.** It receives the generated callback id and runs as a durable step, so it runs exactly once. Whatever you do with the id — email it, put it in a ticket, publish it — an external actor later completes the callback with a payload, and that payload becomes the task's result. With the default deserializer the result is the **raw** payload text, quotes included; supply a serdes if you want it parsed.

**`d.wait` takes a duration, not a callback.** It is the one kind with no body. Here it uses an ordering-only `.after(approval)` edge, because a timer has no interest in the approval's value.

### What gets checkpointed

Three suspend/resume boundaries, so the history spans four invocations:

```text
── invocation 1 ─────────────────────────────────────────────────────────
ExecutionStarted
└── ContextStarted   SubType=Dag  Name=expense       id: 1
    ├── StepStarted   SubType=Step Name=submit       id: 1-DAG_NODE_T_submit
    ├── StepSucceeded SubType=Step Name=submit       → 250
    └── ChainedInvokeStarted  SubType=ChainedInvoke  Name=score
                                                     id: 1-DAG_NODE_T_score
InvocationCompleted                                  ← suspended

── invocation 2 ─ target function returned ──────────────────────────────
    ├── ChainedInvokeSucceeded  Name=score           → 250
    ├── ContextStarted  SubType=Callback  Name=approval
    │                                                id: 1-DAG_NODE_T_approval
    │   ├── ContextStarted SubType=WaitForCallback  Name=approval
    │   │   ├── CallbackStarted  SubType=Callback    (the token)
    │   │   ├── StepStarted   SubType=Step           (your submitter)
    │   │   └── StepSucceeded SubType=Step
InvocationCompleted                                  ← suspended

── invocation 3 ─ external system approved ──────────────────────────────
    │   │   ├── CallbackSucceeded  SubType=Callback  → "approved by dana"
    │   │   └── ContextSucceeded SubType=WaitForCallback
    │   └── ContextSucceeded SubType=Callback  Name=approval
    ├── WaitStarted  SubType=Wait  Name=cooldown     id: 1-DAG_NODE_T_cooldown
InvocationCompleted                                  ← suspended 30s

── invocation 4 ─ timer fired ───────────────────────────────────────────
    ├── WaitSucceeded  SubType=Wait  Name=cooldown
    ├── StepStarted   SubType=Step Name=settle       id: 1-DAG_NODE_T_settle
    ├── StepSucceeded SubType=Step Name=settle       → "settled with approved by dana"
    └── ContextSucceeded  SubType=Dag  Name=expense
InvocationCompleted
ExecutionSucceeded
```

Notice that the DAG container's `ContextStarted` is written once, in invocation 1, and its `ContextSucceeded` only in invocation 4. Everything between is one logical DAG spread across four Lambda invocations, stitched together by the checkpoints. Each resume re-runs the register callback (which is why it must be deterministic), then the scheduler consults the checkpoints, sees `submit` and `score` already succeeded, and picks up at the next ready task without re-executing anything.

The `approval` task is also the one place a task is _not_ flat and _not_ simply its native operation: it is a `Callback`-subtype container wrapping the native `WaitForCallback`. The extra level exists because a callback operation cannot take an explicit name-derived ID directly, so the container carries the task identity instead. This is the documented exception to the flat model (`DAG_SPEC_CROSS_LANGUAGE.md` §2.A.5) — and getting it wrong in three of the four SDKs is what conformance scenario 10-11 caught.
