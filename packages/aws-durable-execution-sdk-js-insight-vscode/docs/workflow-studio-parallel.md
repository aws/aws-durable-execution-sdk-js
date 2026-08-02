# Workflow Studio — parallel node

Add a `parallel` node that runs **multiple named branches concurrently**, each
branch being its own child workflow — mirroring
`context.parallel(name, branches, config)`. It combines the condition node's
"list of branches in the inspector" with map/group's drillable child bodies.

## Model

```ts
interface ParallelBranch {
  id: string;
  name: string; // branch name (context.parallel branch name)
  body: DarWorkflow; // the branch's child workflow
}
interface ParallelNode extends DarNodeCommon {
  kind: "parallel";
  branches: ParallelBranch[];
  maxConcurrency?: number;
  minSuccessful?: number; // completionConfig
  toleratedFailureCount?: number;
  toleratedFailurePercentage?: number;
}
```

## Navigation (reuse map/group drill-in)

The `path` stays `string[]`, but a segment is now **either** a container node id
(map/group, descend into `body`) **or** a parallel **branch id** (descend into
that branch's `body`). `workflowAtPath` / `updateWorkflowAtPath` are generalised
to resolve both. `enterContainer(id)` is reused with a branch id. Because a
parallel node has many bodies, you drill in **per branch** from the inspector
(like condition branches), not by double-clicking the node.

## Working agreement

One subtask per commit; verify (tsc exit-status + build + 194 tests); present;
commit after review.

## Subtasks

- [x] **1. Model + helpers + palette.** Add `parallel` to `DarNodeKind`, the
      `ParallelNode`/`ParallelBranch` types, `NODE_KIND_LABELS`, palette
      `KINDS` + color, `createNode("parallel")` (2 starter branches),
      `parseWorkflow` recursion into each branch body, and generalise
      `workflowAtPath`/`updateWorkflowAtPath` to resolve parallel branch ids.

- [x] **2. Inspector + navigation + canvas.** Parallel inspector: branch list
      (name + "Edit →" (enterContainer) + remove, plus "Add branch"),
      maxConcurrency, and the completion `ExpandableSection`. Extract the
      shared completion fields into a small component reused by map and
      parallel. Breadcrumb resolves branch-id segments (label = branch name);
      parallel card shows an "N branches" summary.
