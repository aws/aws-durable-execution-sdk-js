# Workflow Studio — group node (runInChildContext)

Add a `group` node that runs a **child workflow** under a child context,
mirroring `context.runInChildContext(name, async (childCtx) => { … })`. It
reuses the map node's recursive-body model and drill-in navigation, but has **no
config** — just a name and a body.

## Reuse from map

- Recursive `body: DarWorkflow` on the node.
- Drill-in navigation (`path` / `activeWf` / breadcrumb). The path helpers are
  generalised to walk **any container node** (map or group), not just map.
- Canvas double-click to enter; inspector "Edit workflow →" button; card node
  count; parse recursion.

## Model

```ts
interface GroupNode extends DarNodeCommon {
  kind: "group";
  body: DarWorkflow; // the grouped child workflow (element bindings N/A)
}
```

## Working agreement

One subtask per commit; verify (tsc exit-status + build + 194 tests); present;
commit after review.

## Subtasks

- [x] **1. Model + helpers + palette.** Add `group` to `DarNodeKind`, the
      `GroupNode` interface, `NODE_KIND_LABELS`, palette `KINDS` + color,
      `createNode("group")` (seeds a starter body), `parseWorkflow` recursion,
      and generalise `workflowAtPath`/`updateWorkflowAtPath` (+ an
      `isContainerKind` helper) to walk map **and** group bodies.

- [x] **2. Navigation + UI.** Generalise the drill-in trigger (rename
      `onEnterMap` → `onEnterContainer`), double-click a group card to enter,
      show a "N nodes · dbl-click to edit" summary on the group card, add the
      group inspector case (node count + "Edit workflow →"), and generalise the
      breadcrumb label walk to map|group.
