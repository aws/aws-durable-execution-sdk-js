# Workflow Studio — maintainability refactor

Goal: break the monolithic `webview-ui/src/StudioPage.tsx` (~1650 lines, with a
~920-line component) into small, focused modules before adding more features.
The refactor is **behavior-preserving** — code moves, logic is unchanged.

## Working agreement

- One subtask per commit.
- After each subtask I run the full verification (below) and present the result.
- The reviewer checks it; only once approved do I commit and move to the next.
- Commit style: `refactor(sdk): …`.

## Verification (run after every subtask)

```bash
cd packages/aws-durable-execution-sdk-js-insight-vscode/webview-ui
npx tsc --noEmit         # must exit 0
npm run build            # must succeed
cd .. && npx jest        # 194 tests must pass
```

## Target layout

```
webview-ui/src/
  studio/
    constants.ts        # dimensions, zoom, colors, styles, palette kinds
    CodeField.tsx       # CodeArea + CodeField (TS code editing widgets)
    NodeInspector.tsx   # NodeInspector + NameField + BranchEditor +
                        #   DurationField + StrategyEditor + unitOption
    NodePalette.tsx     # left palette of draggable primitives
    Canvas.tsx          # SVG edges + labels + delete handles + node cards +
                        #   end circles + zoom/auto-layout toolbar
    ValidationPanel.tsx # validation status indicator + details modal
    useWorkflowStudio.ts# wf state + all mutation callbacks (the logic)
  StudioPage.tsx        # thin orchestrator wiring the hook to the components
  studioModel/          # (optional, last) split of studioTypes.ts
```

## Subtasks

- [x] **1. Extract shared constants** → `studio/constants.ts`
      Move `NODE_W/NODE_H`, `MIN/MAX_ZOOM`, `ZOOM_STEP`, `WORLD_W/WORLD_H`,
      `clampZoom`, `zoomBtnStyle`, `KIND_COLORS`, `KINDS`, `DURATION_UNITS`,
      `END_SENTINEL`. Import them back into `StudioPage.tsx`.

- [x] **2. Extract code widgets** → `studio/CodeField.tsx`
      Move `CodeArea` and `CodeField`.

- [x] **3. Extract the inspector** → `studio/NodeInspector.tsx`
      Move `NodeInspector`, `NameField`, `BranchEditor`, `DurationField`,
      `StrategyEditor`, `unitOption`. Props already well-defined.

- [x] **4. Extract the canvas** → `studio/Canvas.tsx`
      Move the SVG defs/edges, branch-label badges, edge delete handles, node
      cards, end circles, and the zoom/auto-layout toolbar. Receives `wf`,
      selection/connecting/error state, zoom, `canvasHeight`, and callbacks.

- [x] **5. Extract the palette** → `studio/NodePalette.tsx`
      Move the left column of draggable primitives.

- [x] **6. Extract the validation panel** → `studio/ValidationPanel.tsx`
      Move the status indicator + details modal.

- [x] **7. Extract state & logic** → `studio/useWorkflowStudio.ts`
      Move the `wf` state and every mutation callback (`addNode`, `updateNode`,
      `deleteNode`, `addEdge`, `deleteEdge`, `setTerminal`, `addBranch`,
      `setBranch`, `endBranch`, drag/drop handlers, zoom/fit/autoLayout, code
      round-trip effect). `StudioPage` becomes a thin composition (~150 lines).

- [x] **8. (Optional) Split `studioTypes.ts`**
      Into `model.ts` (types + `createNode` + `parseWorkflow`), `strategy.ts`,
      `validation.ts`, `layout.ts`, with a barrel `index.ts` re-export so
      existing imports keep working. Do last; it's already cohesive.

## Notes

- `.tsx` files are not run through lint-staged (eslint/prettier) on commit, so
  moving `.tsx` code won't trigger auto-formatting churn; `.ts` files are.
- Prefer a single `studio/` folder over scattering files, and keep prop
  threading explicit (the hook returns one object to reduce boilerplate).
- No behavioral changes in any subtask — if a diff changes behavior, it's a bug.
