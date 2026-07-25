# DAG Examples (TypeScript)

> **Status:** Companion to [`DAG_SPEC.md`](./DAG_SPEC.md) (canonical design) · **Stability:** Experimental (tracks the DAG feature)
>
> Worked examples of `context.dag(...)`, each with the execution history it produces. Every snippet is typechecked against the SDK on this branch. Where behavior differs between SDKs it is called out; the normative cross-language rules live in [`DAG_SPEC_CROSS_LANGUAGE.md`](./DAG_SPEC_CROSS_LANGUAGE.md).

## Example 1 — A linear chain

Three steps, each depending on the one before.

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
