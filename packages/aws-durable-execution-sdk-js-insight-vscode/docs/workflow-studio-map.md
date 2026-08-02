# Workflow Studio — map node (nested child workflow)

Add a `map` node that iterates over an array; **each iteration is a child
workflow**. Visualization uses **drill-in navigation**: the map is a normal node
card, and you drill into its body (a nested `DarWorkflow`) edited with the same
canvas/palette/inspector, with a breadcrumb to navigate back.

## Working agreement

- One subtask per commit; after each I run verification and present the result;
  you review; once approved I commit and move on.
- Commit style: `feat(sdk): …` (or `refactor`/`fix` as appropriate).
- Behavior of existing features must not change.

## Verification (run after every subtask)

```bash
cd packages/aws-durable-execution-sdk-js-insight-vscode/webview-ui
npx tsc --noEmit         # must exit 0
npm run build            # must succeed
cd .. && npx jest        # 194 tests must pass
```

## Model

`map` mirrors `context.map(name, items, iteratee, config)`:

```ts
interface MapNode extends DarNodeCommon {
  kind: "map";
  itemsCode: string; // TS expression returning the array to iterate
  itemName: string; // binding name for each element in the body
  maxConcurrency: number;
  minSuccessful?: number; // completionConfig
  toleratedFailureCount?: number;
  body: DarWorkflow; // the per-iteration workflow (recursive)
}
```

`.dar` becomes recursive JSON. `createNode("map")` seeds `body` with a starter
(start → step1 → end). `parseWorkflow` recurses into each map's `body`.

## Navigation model

The studio operates on an **active workflow** resolved from the recursive root
by a `path: string[]` of map-node ids:

- `path = []` → editing the root workflow.
- `path = [mapA]` → editing `mapA.body`.
- `path = [mapA, mapB]` → editing `mapA.body`'s `mapB.body`, etc.

`activeWf` is derived by walking the path; `setActiveWf(updater)` applies the
updater to the sub-workflow at the path and writes the new root back. Every
existing mutation, plus validation / layout / selection, operates on
`activeWf` — so no per-feature recursion is needed beyond parse.

## Subtasks

- [ ] **1. Model + palette.** Add `map` to `DarNodeKind`, the `MapNode`
      interface, `NODE_KIND_LABELS`, `KIND_COLORS`, palette `KINDS`,
      `createNode("map")` (seeds a starter `body`), and `parseWorkflow`
      recursion into `body`. (No navigation yet.)

- [ ] **2. Active-workflow plumbing in the hook.** Add `path` state, derive
      `activeWf`, add `setActiveWf`, and re-point every mutation + derived value
      (`byId`, `issues`, `errorNodeIds`) at the active level. Add navigation
      actions `enterMap(mapId)` and `exitTo(depth)`. Root behavior unchanged
      when `path` is empty.

- [ ] **3. Breadcrumb + drill-in wiring.** A breadcrumb above the canvas
      (`root › map1 › …`) that pops levels; double-click a map card and an
      "Edit iteration workflow →" inspector button call `enterMap`.

- [ ] **4. Map config UI.** Inspector panel for a map node: items expression
      (CodeField), item binding name, max concurrency, min successful, tolerated
      failures, plus a body summary ("N nodes") and the Edit button.

- [ ] **5. Canvas polish.** Map card shows an "iteration: N nodes" summary and a
      visual cue that it's drillable.

## Notes

- Validation/layout run on `activeWf`, so you see issues for the level you're
  editing; deeper levels are validated when you drill in. (We can add a
  roll-up "child has issues" badge later.)
- The map body always has its own start/end; connecting the map node in the
  parent graph works exactly like any other node.
