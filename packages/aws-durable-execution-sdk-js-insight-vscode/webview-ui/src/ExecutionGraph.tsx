import Box from "@cloudscape-design/components/box";
import Icon, { type IconProps } from "@cloudscape-design/components/icon";
import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import {
  NODE_H,
  NODE_W,
  ZOOM_STEP,
  clampZoom,
  zoomBtnStyle,
} from "./studio/constants";
import type { DarNode, DarWorkflow, ParallelBranch } from "./studioTypes";
import type { OperationNode } from "./types";
import { postMessage } from "./vscode";

type Dir = "TB" | "LR";

/** Fill color for each operation status. */
const STATUS_FILL: Record<string, string> = {
  SUCCEEDED: "#238636",
  FAILED: "#da3633",
  TIMED_OUT: "#da3633",
  RUNNING: "#1f6feb",
  PENDING: "#9e6a03",
  STOPPED: "#6e7681",
  CANCELLED: "#6e7681",
};
const NEUTRAL_FILL = "#30363d";
const CONTAINER_BG = "#161b22";
const BRANCH_BG = "#0d1117";

/** Priority used to pick a node's status when several operations share a name. */
const STATUS_RANK: Record<string, number> = {
  FAILED: 5,
  TIMED_OUT: 5,
  RUNNING: 4,
  PENDING: 3,
  SUCCEEDED: 2,
  STOPPED: 1,
  CANCELLED: 1,
};

// Layout constants.
const PAD = 18;
const HEADER_H = 30;
const BRANCH_HEADER_H = 24;
const GAP_Y = 44;
const GAP_X = 28;
/** Diameter of the small circular start / end nodes. */
const ENDPOINT_SIZE = 56;

/** Builds a name → status map from the operations tree (worst/most-active wins). */
function statusByName(operations: OperationNode[]): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (ops: OperationNode[]) => {
    for (const o of ops) {
      if (o.name) {
        const cur = map.get(o.name);
        if (!cur || (STATUS_RANK[o.status] ?? 0) > (STATUS_RANK[cur] ?? 0)) {
          map.set(o.name, o.status);
        }
      }
      if (o.children) walk(o.children);
    }
  };
  walk(operations);
  return map;
}

/** Picks the worst/most-active of several statuses (by {@link STATUS_RANK}). */
function worstStatus(statuses: (string | undefined)[]): string | undefined {
  let best: string | undefined;
  for (const s of statuses) {
    if (s && (best === undefined || (STATUS_RANK[s] ?? 0) > (STATUS_RANK[best] ?? 0))) {
      best = s;
    }
  }
  return best;
}

/**
 * Resolves a workflow node's status from the operation-name map. Most nodes map
 * 1:1 by name, but an `awsJob` node expands into two operations at codegen time
 * (`<name>-start` step + `<name>-wait` waitForCondition), so its status is the
 * aggregate of those.
 */
function resolveStatus(
  node: DarNode,
  statuses: Map<string, string>,
): string | undefined {
  const direct = statuses.get(node.name);
  if (direct) return direct;
  if (node.kind === "awsJob") {
    return worstStatus([
      statuses.get(`${node.name}-start`),
      statuses.get(`${node.name}-wait`),
    ]);
  }
  return undefined;
}

interface BranchBox {
  branch: ParallelBranch;
  x: number;
  y: number;
  w: number;
  h: number;
  layout: LevelLayout;
  offsetX: number;
  status?: string;
}

interface Placement {
  node: DarNode;
  x: number;
  y: number;
  w: number;
  h: number;
  status?: string;
  /** map/group child layout, rendered at (x+offsetX, y+HEADER_H). */
  body?: LevelLayout;
  bodyOffsetX?: number;
  /** parallel branch sub-boxes, positioned relative to this node's origin. */
  branches?: BranchBox[];
  /** True when this is a container node rendered collapsed (children hidden). */
  collapsed?: boolean;
}

interface LevelLayout {
  placements: Placement[];
  edges: { id: string; from: Placement; to: Placement }[];
  width: number;
  height: number;
}

/** Recursively measures a node and its children into a sized Placement. */
function measure(
  node: DarNode,
  statuses: Map<string, string>,
  collapsed: Set<string>,
  dir: Dir,
): Placement {
  const status = resolveStatus(node, statuses);
  const isContainer =
    node.kind === "map" ||
    node.kind === "group" ||
    node.kind === "dagContainer" ||
    node.kind === "parallel";
  if (isContainer && collapsed.has(node.id)) {
    return { node, x: 0, y: 0, w: NODE_W, h: NODE_H, status, collapsed: true };
  }
  if (
    node.kind === "map" ||
    node.kind === "group" ||
    node.kind === "dagContainer"
  ) {
    const body = layoutLevel(node.body, statuses, collapsed, dir);
    const w = Math.max(NODE_W, body.width + 2 * PAD);
    const h = HEADER_H + body.height + PAD;
    return { node, x: 0, y: 0, w, h, status, body, bodyOffsetX: (w - body.width) / 2 };
  }
  if (node.kind === "parallel") {
    const boxes: BranchBox[] = node.branches.map((branch) => {
      const layout = layoutLevel(branch.body, statuses, collapsed, dir);
      const bw = Math.max(NODE_W, layout.width + 2 * PAD);
      const bh = BRANCH_HEADER_H + layout.height + PAD;
      return {
        branch,
        x: 0,
        y: HEADER_H,
        w: bw,
        h: bh,
        layout,
        offsetX: (bw - layout.width) / 2,
        status: statuses.get(branch.name),
      };
    });
    const contentW =
      boxes.reduce((s, b) => s + b.w, 0) + GAP_X * Math.max(0, boxes.length - 1);
    const contentH = Math.max(NODE_H, ...boxes.map((b) => b.h));
    const w = Math.max(NODE_W, contentW + 2 * PAD);
    const h = HEADER_H + contentH + PAD;
    let bx = (w - contentW) / 2;
    for (const b of boxes) {
      b.x = bx;
      bx += b.w + GAP_X;
    }
    return { node, x: 0, y: 0, w, h, status, branches: boxes };
  }
  if (node.kind === "start" || node.kind === "end") {
    return { node, x: 0, y: 0, w: ENDPOINT_SIZE, h: ENDPOINT_SIZE, status };
  }
  return { node, x: 0, y: 0, w: NODE_W, h: NODE_H, status };
}

/** Lays out one workflow level as a ranked, centered layout along the layout
 *  axis (TB = vertical ranks, LR = horizontal ranks). Nodes on the same rank
 *  (e.g. a condition's branches) are placed side by side, not stacked — a
 *  plain flow-order stack would draw every branch in one column with
 *  overlapping long edges. Child positions are recomputed here so expanded
 *  container boxes never overlap siblings. */
function layoutLevel(
  wf: DarWorkflow,
  statuses: Map<string, string>,
  collapsed: Set<string>,
  dir: Dir,
): LevelLayout {
  const measured = wf.nodes.map((n) => measure(n, statuses, collapsed, dir));

  // Rank = longest-path depth from a root, via edges (matches the Studio's
  // own auto-layout — error-route targets rank below the failing node, not
  // above, and branches of a condition land on the same rank as each other).
  const ids = new Set(measured.map((m) => m.node.id));
  const preds = new Map<string, string[]>();
  for (const id of ids) preds.set(id, []);
  for (const e of wf.edges ?? []) {
    if (ids.has(e.source) && ids.has(e.target)) {
      preds.get(e.target)!.push(e.source);
    }
  }
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

  const byRank = new Map<number, Placement[]>();
  for (const m of measured) {
    const r = rankOf(m.node.id);
    const g = byRank.get(r);
    if (g) g.push(m);
    else byRank.set(r, [m]);
  }
  const ranks = [...byRank.keys()].sort((a, b) => a - b);

  // Order siblings within a rank by the average cross-position of their
  // predecessors (barycenter) to reduce edge crossings, falling back to the
  // model's declared node order for the first rank.
  const crossOf = new Map<string, number>();
  const barycenter = (m: Placement): number => {
    const preIds = preds.get(m.node.id) ?? [];
    const vals = preIds
      .map((p) => crossOf.get(p))
      .filter((v): v is number => v !== undefined);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };

  const GAP = dir === "LR" ? GAP_Y : GAP_X;
  const RANK_GAP = dir === "LR" ? GAP_X : GAP_Y;
  const byId = new Map<string, Placement>();
  let rankCursor = 0;
  let maxCross = 0;
  let minCross = 0;

  for (const r of ranks) {
    const group = byRank.get(r)!;
    const ordered =
      r === ranks[0] ? group : [...group].sort((a, b) => barycenter(a) - barycenter(b));
    // Own cross-axis size (LR: height, TB: width) determines row spacing.
    const crossSize = (m: Placement) => (dir === "LR" ? m.h : m.w);
    const totalCross =
      ordered.reduce((s, m) => s + crossSize(m), 0) + GAP * Math.max(0, ordered.length - 1);
    // Center this rank's own siblings at cross-coordinate 0 (independent of
    // every other rank) — a lone node sits on the shared spine, two siblings
    // split symmetrically either side of it.
    let crossCursor = -totalCross / 2;
    const rankSize = Math.max(...ordered.map((m) => (dir === "LR" ? m.w : m.h)));
    for (const m of ordered) {
      const size = crossSize(m);
      if (dir === "LR") {
        m.x = rankCursor;
        m.y = crossCursor;
      } else {
        m.x = crossCursor;
        m.y = rankCursor;
      }
      crossOf.set(m.node.id, crossCursor + size / 2);
      crossCursor += size + GAP;
      byId.set(m.node.id, m);
      minCross = Math.min(minCross, dir === "LR" ? m.y : m.x);
      maxCross = Math.max(
        maxCross,
        dir === "LR" ? m.y + m.h : m.x + m.w,
      );
    }
    rankCursor += rankSize + RANK_GAP;
  }

  // Shift every placement so the whole level's bounding box starts at
  // (0,0) — layoutLevel's contract for its own width/height and for the
  // parent (map/parallel) that offsets this level within its own box.
  const crossShift = -minCross;
  for (const m of measured) {
    if (dir === "LR") m.y += crossShift;
    else m.x += crossShift;
  }
  const width = dir === "LR" ? Math.max(0, rankCursor - RANK_GAP) : maxCross + crossShift;
  const height = dir === "LR" ? maxCross + crossShift : Math.max(0, rankCursor - RANK_GAP);

  const edges = (wf.edges ?? [])
    .map((e) => {
      const from = byId.get(e.source);
      const to = byId.get(e.target);
      return from && to ? { id: e.id, from, to } : null;
    })
    .filter((e): e is { id: string; from: Placement; to: Placement } => !!e);
  return { placements: measured, edges, width, height };
}

function edgePath(from: Placement, to: Placement, dir: Dir): string {
  const x1 = dir === "LR" ? from.x + from.w : from.x + from.w / 2;
  const y1 = dir === "LR" ? from.y + from.h / 2 : from.y + from.h;
  const x2 = dir === "LR" ? to.x : to.x + to.w / 2;
  const y2 = dir === "LR" ? to.y + to.h / 2 : to.y;
  // c1 sits a fixed distance straight out from the source ALONG THE FLOW
  // AXIS (not toward the target), and c2 the same distance back from the
  // target along the straight source→target line — keeps both tangents
  // well-behaved (a near-vertical/horizontal exit and entry) even when a
  // branch fans out far to one side, unlike a shared-midline S-curve which
  // visually skews for wide, short branches (e.g. a condition's siblings).
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const off = Math.min(60, len / 2);
  const ex = (dx / len) * off;
  const ey = (dy / len) * off;
  const c1x = dir === "LR" ? x1 + off : x1;
  const c1y = dir === "LR" ? y1 : y1 + off;
  const c2x = x2 - ex;
  const c2y = y2 - ey;
  return `M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
}

const statusFill = (s?: string) => (s ? (STATUS_FILL[s] ?? NEUTRAL_FILL) : NEUTRAL_FILL);

/** Renders one workflow level (edges behind nodes) in the current coordinate space. */
function Level({
  layout,
  onToggle,
  dir,
}: {
  layout: LevelLayout;
  onToggle: (id: string) => void;
  dir: Dir;
}) {
  return (
    <>
      {layout.edges.map((e) => (
        <path
          key={e.id}
          d={edgePath(e.from, e.to, dir)}
          fill="none"
          stroke="#8b949e"
          strokeWidth={2}
          markerEnd="url(#exec-arrow)"
        />
      ))}
      {layout.placements.map((p) => (
        <NodeBox key={p.node.id} p={p} onToggle={onToggle} dir={dir} />
      ))}
    </>
  );
}

/** Small clickable +/− badge at a container's top-right corner. */
function ToggleBadge({
  x,
  y,
  collapsed,
  onClick,
}: {
  x: number;
  y: number;
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <g
      style={{ cursor: "pointer" }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <circle cx={x} cy={y} r={9} fill="#0d1117" stroke="#8b949e" />
      <text
        x={x}
        y={y + 4}
        textAnchor="middle"
        fontSize={14}
        fontWeight={700}
        fill="#e6edf3"
      >
        {collapsed ? "+" : "−"}
      </text>
    </g>
  );
}

/** A short "N nodes" / "N branches" hint for a collapsed container. */
function childCount(node: DarNode): string {
  if (
    node.kind === "map" ||
    node.kind === "group" ||
    node.kind === "dagContainer"
  ) {
    const n = node.body.nodes.length;
    return `${n} node${n === 1 ? "" : "s"}`;
  }
  if (node.kind === "parallel") {
    const n = node.branches.length;
    return `${n} branch${n === 1 ? "" : "es"}`;
  }
  return "";
}

function NodeBox({
  p,
  onToggle,
  dir,
}: {
  p: Placement;
  onToggle: (id: string) => void;
  dir: Dir;
}) {
  const isContainer =
    p.node.kind === "map" ||
    p.node.kind === "group" ||
    p.node.kind === "dagContainer" ||
    p.node.kind === "parallel";

  // Leaf nodes (non-containers).
  if (!isContainer) {
    // Start / end render as a small circle.
    if (p.node.kind === "start" || p.node.kind === "end") {
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      return (
        <g>
          <circle
            cx={cx}
            cy={cy}
            r={p.w / 2}
            fill={statusFill(p.status)}
            stroke="#c9d1d9"
            strokeOpacity={0.35}
          />
          <text
            x={cx}
            y={cy + 4}
            textAnchor="middle"
            fontSize={12}
            fontWeight={600}
            fill="#ffffff"
          >
            {p.node.kind}
          </text>
        </g>
      );
    }
    return (
      <g>
        <rect
          x={p.x}
          y={p.y}
          width={p.w}
          height={p.h}
          rx={10}
          fill={statusFill(p.status)}
          stroke="#c9d1d9"
          strokeOpacity={0.25}
        />
        <text
          x={p.x + p.w / 2}
          y={p.y + p.h / 2 - 4}
          textAnchor="middle"
          fontSize={14}
          fontWeight={600}
          fill="#ffffff"
        >
          {p.node.name || p.node.kind}
        </text>
        <text
          x={p.x + p.w / 2}
          y={p.y + p.h / 2 + 16}
          textAnchor="middle"
          fontSize={11}
          fill="#ffffff"
          opacity={0.85}
        >
          {p.node.kind}
          {p.status ? ` · ${p.status}` : ""}
        </text>
      </g>
    );
  }

  // Container node: outlined box with a header, children rendered inside.
  const toggleX = p.x + p.w - 16;
  const toggleY = p.y + 16;

  // Collapsed: compact box with an expand (+) badge, children hidden.
  if (p.collapsed) {
    return (
      <g>
        <rect
          x={p.x}
          y={p.y}
          width={p.w}
          height={p.h}
          rx={12}
          fill={CONTAINER_BG}
          stroke={statusFill(p.status)}
          strokeWidth={2.5}
        />
        <text
          x={p.x + p.w / 2}
          y={p.y + p.h / 2 - 4}
          textAnchor="middle"
          fontSize={13}
          fontWeight={600}
          fill="#e6edf3"
        >
          {p.node.name || p.node.kind}
        </text>
        <text
          x={p.x + p.w / 2}
          y={p.y + p.h / 2 + 14}
          textAnchor="middle"
          fontSize={10}
          fill="#8b949e"
        >
          {p.node.kind} · {childCount(p.node)}
          {p.status ? ` · ${p.status}` : ""}
        </text>
        <ToggleBadge
          x={toggleX}
          y={toggleY}
          collapsed
          onClick={() => onToggle(p.node.id)}
        />
      </g>
    );
  }

  return (
    <g>
      <rect
        x={p.x}
        y={p.y}
        width={p.w}
        height={p.h}
        rx={12}
        fill={CONTAINER_BG}
        stroke={statusFill(p.status)}
        strokeWidth={2.5}
      />
      <text
        x={p.x + p.w / 2}
        y={p.y + 19}
        textAnchor="middle"
        fontSize={13}
        fontWeight={600}
        fill="#e6edf3"
      >
        {(p.node.name || p.node.kind) + " · " + p.node.kind}
        {p.status ? ` · ${p.status}` : ""}
      </text>

      <ToggleBadge
        x={toggleX}
        y={toggleY}
        collapsed={false}
        onClick={() => onToggle(p.node.id)}
      />

      {p.body && (
        <g transform={`translate(${p.x + (p.bodyOffsetX ?? PAD)}, ${p.y + HEADER_H})`}>
          <Level layout={p.body} onToggle={onToggle} dir={dir} />
        </g>
      )}

      {p.branches?.map((b) => (
        <g key={b.branch.id}>
          <rect
            x={p.x + b.x}
            y={p.y + b.y}
            width={b.w}
            height={b.h}
            rx={10}
            fill={BRANCH_BG}
            stroke={statusFill(b.status)}
            strokeOpacity={b.status ? 0.9 : 0.4}
            strokeWidth={1.5}
          />
          <text
            x={p.x + b.x + b.w / 2}
            y={p.y + b.y + 16}
            textAnchor="middle"
            fontSize={11}
            fontWeight={600}
            fill="#e6edf3"
          >
            {b.branch.name}
          </text>
          <g
            transform={`translate(${p.x + b.x + b.offsetX}, ${p.y + b.y + BRANCH_HEADER_H})`}
          >
            <Level layout={b.layout} onToggle={onToggle} dir={dir} />
          </g>
        </g>
      ))}
    </g>
  );
}

const LEGEND: { label: string; color: string }[] = [
  { label: "Succeeded", color: STATUS_FILL.SUCCEEDED },
  { label: "Failed", color: STATUS_FILL.FAILED },
  { label: "Running", color: STATUS_FILL.RUNNING },
  { label: "Pending", color: STATUS_FILL.PENDING },
  { label: "Not run", color: NEUTRAL_FILL },
];

/** All collapsible container ids (map/group/parallel), including nested ones. */
function collectContainerIds(wf: DarWorkflow): string[] {
  const ids: string[] = [];
  const walk = (w: DarWorkflow) => {
    for (const n of w.nodes) {
      if (n.kind === "map" || n.kind === "group") {
        ids.push(n.id);
        walk(n.body);
      } else if (n.kind === "parallel") {
        ids.push(n.id);
        for (const b of n.branches) walk(b.body);
      }
    }
  };
  walk(wf);
  return ids;
}

interface ExecutionGraphProps {
  workflow: DarWorkflow;
  operations: OperationNode[];
  /** Forwards the rendered `<svg>` DOM node — used to export the graph as
   *  SVG/PNG (e.g. from the Studio, off-screen and fully expanded). */
  svgRef?: Ref<SVGSVGElement>;
  /** Fixes the zoom instead of auto-fitting to the container; used for
   *  export so the produced image is 1:1 regardless of viewport size. */
  fixedZoom?: number;
  /** Hides the zoom/direction/expand toolbar (export renders just the graph). */
  hideToolbar?: boolean;
}

/**
 * Read-only rendering of the workflow graph (from the embedded `.dar`), colored
 * by operation status. Map/group/parallel nodes are drawn as boxes containing
 * their child workflow(s), recursively.
 */
export function ExecutionGraph({
  workflow,
  operations,
  svgRef,
  fixedZoom,
  hideToolbar,
}: ExecutionGraphProps) {
  const statuses = statusByName(operations);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dir, setDir] = useState<Dir>("TB");
  const [zoom, setZoom] = useState(fixedZoom ?? 1);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Own ref (for the built-in Export SVG/PNG buttons below), forwarding to
  // the caller's optional svgRef too (the Studio uses this to grab the SVG
  // from an off-screen, always-expanded instance).
  const ownSvgRef = useRef<SVGSVGElement | null>(null);
  const setSvgRef = (el: SVGSVGElement | null) => {
    ownSvgRef.current = el;
    if (typeof svgRef === "function") svgRef(el);
    else if (svgRef && "current" in svgRef)
      (svgRef as { current: SVGSVGElement | null }).current = el;
  };
  const filenameBase = () =>
    (workflow.name || "workflow")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workflow";
  const exportGraph = (format: "svg" | "png") => {
    const svg = ownSvgRef.current;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    if (format === "svg") {
      const content = xml.startsWith("<?xml")
        ? xml
        : `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
      postMessage({
        type: "exportChart",
        format: "svg",
        content,
        filename: `${filenameBase()}.svg`,
      });
      return;
    }
    // PNG: rasterize the SVG via an offscreen <img>/<canvas> (no server round
    // trip — the browser's own SVG renderer draws it).
    const width = Number(svg.getAttribute("width")) || svg.clientWidth || 800;
    const height =
      Number(svg.getAttribute("height")) || svg.clientHeight || 600;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      // 2x scale for a crisp export on high-DPI displays.
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#0d1117";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0, width, height);
      postMessage({
        type: "exportChart",
        format: "png",
        content: canvas.toDataURL("image/png"),
        filename: `${filenameBase()}.png`,
      });
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  };
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const layout = layoutLevel(workflow, statuses, collapsed, dir);
  const containerIds = collectContainerIds(workflow);

  const pad = 24;
  const vbW = layout.width + 2 * pad;
  const vbH = layout.height + 2 * pad;

  // Fit the whole graph into the visible viewport (never above 100%).
  const fit = useCallback(() => {
    const c = scrollRef.current;
    if (!c || vbW === 0 || vbH === 0) return;
    setZoom(
      clampZoom(
        Math.min((c.clientWidth - 16) / vbW, (c.clientHeight - 16) / vbH, 1),
      ),
    );
  }, [vbW, vbH]);
  // Auto-fit when the graph size changes (initial render, direction flip,
  // expand/collapse) — skipped when the caller pins the zoom (export).
  useEffect(() => {
    if (fixedZoom === undefined) fit();
  }, [fit, fixedZoom]);

  if (layout.placements.length === 0) {
    return (
      <Box textAlign="center" color="text-status-inactive">
        The embedded workflow has no nodes.
      </Box>
    );
  }

  const btn = (
    iconName: IconProps.Name,
    title: string,
    onClick: () => void,
  ) => (
    <button
      type="button"
      className="wf-tip"
      data-tip={title}
      title={title}
      onClick={onClick}
      style={{
        ...zoomBtnStyle,
        width: "auto",
        minWidth: 26,
        padding: "0 7px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={iconName} />
    </button>
  );

  return (
    <div>
      {!hideToolbar && (
      <div
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 8,
          alignItems: "center",
        }}
      >
        <style>{`
          .wf-tip { position: relative; }
          .wf-tip::after {
            content: attr(data-tip);
            position: absolute; top: calc(100% + 6px); left: 50%;
            transform: translateX(-50%);
            background: #0d1117; color: #e6edf3;
            border: 1px solid #30363d; border-radius: 4px;
            padding: 2px 6px; font-size: 11px; white-space: nowrap;
            opacity: 0; pointer-events: none; transition: opacity 0.08s;
            z-index: 20;
          }
          .wf-tip:hover::after { opacity: 1; }
        `}</style>
        {btn("zoom-out", "Zoom out", () =>
          setZoom((z) => clampZoom(z / ZOOM_STEP)),
        )}
        <span style={{ fontSize: 12, color: "#8b949e", minWidth: 38, textAlign: "center" }}>
          {Math.round(zoom * 100)}%
        </span>
        {btn("zoom-in", "Zoom in", () => setZoom((z) => clampZoom(z * ZOOM_STEP)))}
        {btn("zoom-to-fit", "Fit to view", fit)}
        {btn(
          dir === "LR" ? "angle-right" : "angle-down",
          dir === "LR"
            ? "Direction: left-to-right (click for top-to-bottom)"
            : "Direction: top-to-bottom (click for left-to-right)",
          () => setDir((d) => (d === "TB" ? "LR" : "TB")),
        )}
        {containerIds.length > 0 && (
          <>
            <span
              style={{ width: 1, alignSelf: "stretch", background: "#30363d" }}
            />
            {btn("treeview-expand", "Expand all sub-workflows", () =>
              setCollapsed(new Set()),
            )}
            {btn("treeview-collapse", "Collapse all sub-workflows", () =>
              setCollapsed(new Set(containerIds)),
            )}
          </>
        )}
        <span
          style={{ width: 1, alignSelf: "stretch", background: "#30363d" }}
        />
        {btn("download", "Export as SVG", () => exportGraph("svg"))}
        {btn("file", "Export as PNG", () => exportGraph("png"))}
      </div>
      )}
      <div
        ref={scrollRef}
        style={{
          background: "#0d1117",
          borderRadius: 8,
          overflow: "auto",
          maxHeight: 600,
          padding: 12,
        }}
      >
        <svg
          ref={setSvgRef}
          viewBox={`0 0 ${vbW} ${vbH}`}
          width={vbW * zoom}
          height={vbH * zoom}
          style={{ display: "block" }}
          role="img"
          aria-label="Execution workflow graph"
        >
          <defs>
            <marker
              id="exec-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 Z" fill="#8b949e" />
            </marker>
          </defs>
          <g transform={`translate(${pad}, ${pad})`}>
            <Level layout={layout} onToggle={toggle} dir={dir} />
          </g>
        </svg>
      </div>

      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          marginTop: 8,
          fontSize: 12,
        }}
      >
        {LEGEND.map((l) => (
          <span
            key={l.label}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: l.color,
                display: "inline-block",
              }}
            />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
