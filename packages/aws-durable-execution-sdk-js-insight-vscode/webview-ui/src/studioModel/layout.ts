import type {
  DarNode,
  DarPosition,
  DarWorkflow,
  LayoutDirection,
} from "./model";

/**
 * A stable string that captures ONLY a workflow's structure — its set of node
 * ids and its set of connections (each edge as `source>target`) — and ignores
 * node positions entirely. Both sets are sorted before joining so the result
 * is order-independent (reordering nodes/edges in the array doesn't change it).
 *
 * Used to drive "auto-arrange on change": a change to this signature means a
 * node or connection was added/removed (a structural edit), whereas dragging a
 * node only moves its position and leaves the signature untouched. That
 * property is what makes an auto-layout triggered by a signature change safe
 * from infinite loops — auto-layout rewrites positions but never the structure,
 * so it can't re-trigger itself.
 */
export function structuralSignature(wf: {
  nodes: { id: string }[];
  edges: { source: string; target: string }[];
}): string {
  const nodeIds = wf.nodes
    .map((n) => n.id)
    .sort()
    .join(",");
  const edgeIds = wf.edges
    .map((e) => `${e.source}>${e.target}`)
    .sort()
    .join(",");
  return `${nodeIds}|${edgeIds}`;
}

/**
 * Auto-arranges nodes into a layered layout (Sugiyama-style): each node's rank
 * is its longest-path depth from a root, and nodes within a rank are ordered by
 * the average cross-position of their predecessors to reduce edge crossings.
 * `direction` places successive ranks top-to-bottom ("TB", default) or
 * left-to-right ("LR"). Pure — returns a new workflow with updated positions
 * (edges unchanged).
 */
export function autoLayout(
  wf: DarWorkflow,
  direction: LayoutDirection = "TB",
): DarWorkflow {
  const { nodes, edges } = wf;
  if (nodes.length === 0) return wf;

  const ids = new Set(nodes.map((n) => n.id));
  const preds = new Map<string, string[]>();
  for (const id of ids) preds.set(id, []);
  // All routing is edges — error edges included, so an error-route target
  // ranks below its failing node, not above.
  for (const e of edges) {
    if (ids.has(e.source) && ids.has(e.target)) {
      preds.get(e.target)!.push(e.source);
    }
  }

  // Longest-path rank from roots, with a guard so cycles don't recurse forever.
  const rankMemo = new Map<string, number>();
  const visiting = new Set<string>();
  const rankOf = (id: string): number => {
    const cached = rankMemo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let r = 0;
    for (const p of preds.get(id) ?? []) r = Math.max(r, rankOf(p) + 1);
    visiting.delete(id);
    rankMemo.set(id, r);
    return r;
  };

  const byRank = new Map<number, DarNode[]>();
  for (const n of nodes) {
    const r = rankOf(n.id);
    const g = byRank.get(r);
    if (g) g.push(n);
    else byRank.set(r, [n]);
  }

  const ROW_GAP = 160;
  const COL_GAP = 240;
  const MARGIN = 40;
  // Spacing along the rank axis (between successive layers) vs. the cross axis
  // (between siblings in a layer). Swapped for LR so ranks flow rightward.
  const rankGap = direction === "LR" ? COL_GAP : ROW_GAP;
  const crossGap = direction === "LR" ? ROW_GAP : COL_GAP;
  const ranks = [...byRank.keys()].sort((a, b) => a - b);

  // Column index of each node within its (already-ordered) row.
  const col = new Map<string, number>();
  const baryCol = (n: DarNode): number => {
    const cols = (preds.get(n.id) ?? [])
      .map((p) => col.get(p))
      .filter((c): c is number => c !== undefined);
    return cols.length ? cols.reduce((a, b) => a + b, 0) / cols.length : 0;
  };

  const ordered = new Map<number, DarNode[]>();
  for (const r of ranks) {
    const group = byRank.get(r)!;
    const arr =
      r === ranks[0]
        ? group
        : [...group].sort((a, b) => baryCol(a) - baryCol(b));
    ordered.set(r, arr);
    arr.forEach((n, i) => col.set(n.id, i));
  }

  const posById = new Map<string, DarPosition>();
  for (const r of ranks) {
    const arr = ordered.get(r)!;
    const rowCross = (arr.length - 1) * crossGap;
    // Center this row's own siblings at cross-coordinate 0 — a single node
    // sits exactly on the shared spine (e.g. directly under/right of its
    // parent), two siblings split symmetrically to -crossGap/2 / +crossGap/2,
    // and so on. Independent of every other row (and of the viewport), so
    // positions don't depend on where the row was scrolled/how wide the
    // window was — see frameCentered, which only scrolls the view now.
    const crossStart = -rowCross / 2;
    const rankCoord = MARGIN + r * rankGap;
    arr.forEach((n, i) => {
      const crossCoord = Math.round(crossStart + i * crossGap);
      posById.set(
        n.id,
        direction === "LR"
          ? { x: rankCoord, y: crossCoord }
          : { x: crossCoord, y: rankCoord },
      );
    });
  }

  return {
    ...wf,
    nodes: nodes.map((n) => ({
      ...n,
      position: posById.get(n.id) ?? n.position,
    })),
  };
}
