import { newId } from "./model";
import type { DarNode, DarWorkflow } from "./model";

// Node card footprint, mirrors studio/constants.ts's NODE_W/NODE_H — update
// both if node card dimensions ever change.
const NODE_W = 190;
const NODE_H = 72;
// Diameter of the start-node circle (mirrors Canvas' START_D) for edge geometry.
const START_D = 44;

/** Perpendicular distance from a point to a segment. */
export function pointSegDist(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * The id of the edge whose (source-bottom → target-top) segment passes closest
 * to a point, within `threshold` world units — or null. Used to decide which
 * link a dragged silo node should be inserted onto.
 */
export function nearestEdgeId(
  wf: DarWorkflow,
  px: number,
  py: number,
  excludeNodeId: string,
  threshold = 45,
): string | null {
  const byId = new Map(wf.nodes.map((n) => [n.id, n]));
  let best: string | null = null;
  let bestDist = threshold;
  for (const e of wf.edges) {
    if (e.source === excludeNodeId || e.target === excludeNodeId) continue;
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) continue;
    const x1 = s.position.x + NODE_W / 2;
    const y1 =
      s.kind === "start" ? s.position.y + START_D : s.position.y + NODE_H;
    const x2 = t.position.x + NODE_W / 2;
    const y2 = t.position.y;
    const dist = pointSegDist(px, py, x1, y1, x2, y2);
    if (dist < bestDist) {
      bestDist = dist;
      best = e.id;
    }
  }
  return best;
}

/**
 * Insert-on-edge shared layout: reposition `nodeId` (already in `w.nodes`) one
 * node-height below the edge's source on the midline, push the target subtree
 * down if it would overlap, and rewire A→B into A→node→B (label kept on the
 * first segment). Returns `w` unchanged if the edge/node don't apply.
 */
export function insertNodeOnEdgeInWorkflow(
  w: DarWorkflow,
  edgeId: string,
  nodeId: string,
  dir: "TB" | "LR" = "TB",
): DarWorkflow {
  const edge = w.edges.find((e) => e.id === edgeId);
  if (!edge || edge.source === nodeId || edge.target === nodeId) return w;
  const src = w.nodes.find((n) => n.id === edge.source);
  const tgt = w.nodes.find((n) => n.id === edge.target);
  const self = w.nodes.find((n) => n.id === nodeId);
  if (!self) return w;
  const GAP = 60;
  // Place the inserted node one step past the source along the layout axis, on
  // the midline of the cross axis.
  const insertedX =
    dir === "LR"
      ? src
        ? src.position.x + NODE_W + GAP
        : self.position.x
      : src && tgt
        ? Math.round((src.position.x + tgt.position.x) / 2)
        : self.position.x;
  const insertedY =
    dir === "LR"
      ? src && tgt
        ? Math.round((src.position.y + tgt.position.y) / 2)
        : self.position.y
      : src
        ? src.position.y + NODE_H + GAP
        : self.position.y;

  let nodes = w.nodes.map((n) =>
    n.id === nodeId
      ? ({
          ...n,
          position: { x: Math.round(insertedX), y: Math.round(insertedY) },
        } as DarNode)
      : n,
  );

  if (tgt) {
    const shift =
      dir === "LR"
        ? insertedX + NODE_W + GAP - tgt.position.x
        : insertedY + NODE_H + GAP - tgt.position.y;
    if (shift > 0) {
      const adj = new Map<string, string[]>();
      for (const e of w.edges) {
        const list = adj.get(e.source);
        if (list) list.push(e.target);
        else adj.set(e.source, [e.target]);
      }
      const move = new Set<string>();
      const stack = [tgt.id];
      while (stack.length > 0) {
        const id = stack.pop() as string;
        if (move.has(id)) continue;
        move.add(id);
        for (const nx of adj.get(id) ?? []) stack.push(nx);
      }
      move.delete(edge.source); // never move the source (guards cycles)
      move.delete(nodeId); // the inserted node is positioned explicitly
      nodes = nodes.map((n) =>
        move.has(n.id)
          ? ({
              ...n,
              position:
                dir === "LR"
                  ? { ...n.position, x: n.position.x + shift }
                  : { ...n.position, y: n.position.y + shift },
            } as DarNode)
          : n,
      );
    }
  }

  const edges = w.edges.filter((e) => e.id !== edgeId);
  edges.push({
    id: newId("e"),
    source: edge.source,
    target: nodeId,
    // A condition-branch edge keeps its match on the first half of the split.
    ...(edge.match ? { match: edge.match } : {}),
  });
  edges.push({ id: newId("e"), source: nodeId, target: edge.target });
  return { ...w, nodes, edges };
}
