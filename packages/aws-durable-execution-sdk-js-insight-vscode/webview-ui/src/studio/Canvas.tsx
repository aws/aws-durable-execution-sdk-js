/**
 * The Workflow Studio canvas: a scrollable, zoomable "world" that renders the
 * workflow graph — SVG edges (with condition match/else labels), edge delete
 * handles, node cards, end-node circles — plus a fixed zoom/auto-layout
 * toolbar. Pure presentation: all state and mutations live in StudioPage and
 * are passed in as props.
 */
import { Fragment, useRef, useState } from "react";
import Icon from "@cloudscape-design/components/icon";
import {
  KIND_COLORS,
  MAX_ZOOM,
  MIN_ZOOM,
  NODE_H,
  NODE_ICONS,
  NODE_W,
  WORLD_H,
  WORLD_ORIGIN_X,
  WORLD_ORIGIN_Y,
  WORLD_W,
  zoomBtnStyle,
} from "./constants";
import { NODE_KIND_LABELS, isContainerKind, inferDependencyKind, flowEdges } from "../studioTypes";
import { getServiceIntegration } from "@aws/durable-execution-sdk-js-visual-workflow-model";
import type { DarNode, DarWorkflow } from "../studioTypes";

/** Diameter of the start-node circle (smaller than a full node card). */
const START_D = 44;

// Node-breakpoint / paused-node colors, kept in visual agreement with the
// code view's own gutter (see monacoSetup.ts): the breakpoint glyph is
// #e51400 (red), the paused top-frame wash/arrow is yellow (#ffcc00 /
// rgba(255,214,0,…)). The canvas reuses the same hues so a node breakpoint /
// paused node reads as "the same thing" the code view shows.
const BREAKPOINT_RED = "#e51400";
const PAUSED_YELLOW = "#ffcc00";

/**
 * A per-node breakpoint toggle affordance rendered on the node card/circle: a
 * small circle, filled red when the node has a breakpoint, hollow (with a faint
 * red hover fill) otherwise. Clicking toggles the node breakpoint via
 * `onToggle`; pointer-down/click both stopPropagation so it never starts a
 * node drag or selects/opens the node. A module-level component (not an inline
 * closure) so each dot owns its own hover state without breaking the rules of
 * hooks inside the node `.map`. Renders nothing when `onToggle` is absent (a
 * host that can't set breakpoints — the canvas simply shows no dot).
 */
/**
 * Whether a node kind can carry a breakpoint at all.
 *
 * `start` is pure structure: the generator emits NO code for it (see
 * `generateHandler.ts`'s `emitChain`, which just walks past it to the first
 * real operation), so its `.dar.ts` declaration line maps to no bundle line
 * and a breakpoint there can never bind. Offering a dot would promise a pause
 * that never arrives — and, before the map bridge was made exact, actually
 * bound to the NEXT node and glowed the wrong one. Every other kind emits at
 * least its own operation line, so a node breakpoint on it is meaningful:
 * `wait`, `parallel`, `map`, `condition`, `end` and friends have no code body
 * of their own but still pause on entry to the operation.
 */
const nodeCanBreak = (kind: string): boolean => kind !== "start";

function BreakpointDot({
  nodeId,
  active,
  onToggle,
  style,
}: {
  nodeId: string;
  active: boolean;
  onToggle?: (nodeId: string) => void;
  style?: React.CSSProperties;
}) {
  const [hover, setHover] = useState(false);
  if (!onToggle) return null;
  return (
    <span
      role="button"
      aria-label={active ? "Remove node breakpoint" : "Set node breakpoint"}
      title={active ? "Remove breakpoint" : "Set breakpoint on this node"}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(nodeId);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 11,
        height: 11,
        borderRadius: "50%",
        boxSizing: "border-box",
        flexShrink: 0,
        cursor: "pointer",
        background: active
          ? BREAKPOINT_RED
          : hover
            ? "rgba(229,20,0,0.35)"
            : "transparent",
        border: `1px solid ${active ? BREAKPOINT_RED : "#8b949e"}`,
        ...style,
      }}
    />
  );
}

type Dir = "TB" | "LR";

/** Edge endpoints from node `s` to node `t` for the given layout direction.
 *  `heights` carries measured card heights — container cards (parallel, jobs)
 *  grow beyond NODE_H, and anchors must sit on the real border. */
function anchorsFor(
  s: DarNode,
  t: DarNode,
  dir: Dir,
  heights?: Map<string, number>,
) {
  // start/end render as a START_D circle centered on the box's top-center;
  // every other node is a full NODE_W-wide card of measured height.
  const geom = (n: DarNode) => {
    const circle = n.kind === "start" || n.kind === "end";
    const h = circle ? NODE_H : (heights?.get(n.id) ?? NODE_H);
    // Circles are centered within the same NODE_W×NODE_H box as cards, so their
    // center aligns with neighbours' centers (keeps start→first / last→end
    // edges straight in both directions); only the radius differs.
    const cx = n.position.x + WORLD_ORIGIN_X + NODE_W / 2;
    const cy = n.position.y + WORLD_ORIGIN_Y + h / 2;
    const half = circle ? START_D / 2 : 0;
    return {
      cx,
      cy,
      halfW: circle ? half : NODE_W / 2,
      halfH: circle ? half : h / 2,
    };
  };
  const a = geom(s);
  const b = geom(t);
  if (dir === "LR") {
    // Exit the right of the source, enter the left of the target — using
    // each node's NOMINAL row-center (position.y + NODE_H/2), not its
    // measured-height center. Cards are top-anchored and grow downward, so
    // rows sharing one `position.y` (the layout's LR row-alignment
    // guarantee) only look aligned if every node's cross-axis anchor is
    // pinned to that shared nominal center — otherwise a card whose real
    // height differs from NODE_H (e.g. a plain step vs. a start/end circle,
    // or two cards with different wrapped text) drifts the edge off-horizontal.
    const ay = s.position.y + WORLD_ORIGIN_Y + NODE_H / 2;
    const by = t.position.y + WORLD_ORIGIN_Y + NODE_H / 2;
    return { x1: a.cx + a.halfW, y1: ay, x2: b.cx - b.halfW, y2: by };
  }
  // TB (default): exit the bottom of the source, enter the top of the target.
  return { x1: a.cx, y1: a.cy + a.halfH, x2: b.cx, y2: b.cy - b.halfH };
}

/** Control points of the cubic between two anchors (shared by path/midpoint). */
function edgeControls(a: ReturnType<typeof anchorsFor>, dir: Dir) {
  const dx = a.x2 - a.x1;
  const dy = a.y2 - a.y1;
  const len = Math.hypot(dx, dy) || 1;
  const off = Math.min(60, len / 2);
  const ex = (dx / len) * off;
  const ey = (dy / len) * off;
  const c1x = dir === "LR" ? a.x1 + off : a.x1;
  const c1y = dir === "LR" ? a.y1 : a.y1 + off;
  return { c1x, c1y, c2x: a.x2 - ex, c2y: a.y2 - ey };
}

/** A cubic path between two anchors, curving out along the layout axis. */
function edgePathFor(a: ReturnType<typeof anchorsFor>, dir: Dir): string {
  const { c1x, c1y, c2x, c2y } = edgeControls(a, dir);
  return `M${a.x1},${a.y1} C${c1x},${c1y} ${c2x},${c2y} ${a.x2},${a.y2}`;
}

/**
 * The curve's true midpoint (Bézier at t = 0.5) — used for badges and the
 * delete handle so they sit ON the drawn path. The anchor average drifts off
 * the curve on diagonal edges.
 */
function edgeMid(a: ReturnType<typeof anchorsFor>, dir: Dir) {
  const { c1x, c1y, c2x, c2y } = edgeControls(a, dir);
  return {
    mx: (a.x1 + 3 * c1x + 3 * c2x + a.x2) / 8,
    my: (a.y1 + 3 * c1y + 3 * c2y + a.y2) / 8,
  };
}

/**
 * Canvas subtitle for a `httpCall` node: "POST api.stripe.com". Falls back to
 * the raw url when it isn't parseable (it may contain `${…}` template holes,
 * which `new URL()` rejects).
 */
function httpCallSubtitle(node: { method?: string; url?: string }): string {
  const method = node.method ?? "GET";
  const url = node.url ?? "";
  if (url === "") return method;
  const host = /^https?:\/\/([^/]+)/i.exec(url)?.[1];
  return `${method} ${host ?? url.slice(0, 28)}`;
}

export function Canvas({
  canvasRef,
  canvasHeight,
  zoom,
  wf,
  byId,
  selectedId,
  connectingFrom,
  errorNodeIds,
  breakpointNodeIds,
  breakpointsSupported,
  onToggleNodeBreakpoint,
  pausedNodeId,
  onDrop,
  onDropOnEdge,
  pointerInsertEdgeId,
  onClearConnecting,
  onNodeClick: onNodeClickProp,
  onNodePointerDown,
  onConnectFrom,
  onDeleteNode,
  onDeleteEdge,
  onEnterContainer,
  onAddParallelBranch,
  onDeleteParallelBranch,
  onZoomIn,
  onZoomOut,
  onAutoFit,
  onAutoLayout,
  layoutLocked,
  onToggleLayoutLock,
  direction,
  onSetDirection,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: {
  canvasRef: React.RefObject<HTMLDivElement>;
  canvasHeight: number;
  zoom: number;
  wf: DarWorkflow;
  byId: Map<string, DarNode>;
  selectedId: string | null;
  connectingFrom: string | null;
  errorNodeIds: Set<string>;
  /** Node ids with an active breakpoint on their `.dar.ts` decl line — drives
   *  the filled breakpoint dot. */
  breakpointNodeIds?: string[];
  /** False when the host can't register real breakpoints at all (kept for
   *  parity with the code view; when false no toggle handler is threaded so
   *  dots simply don't render). */
  breakpointsSupported?: boolean;
  /** Toggle the node breakpoint for a node id (host owns nodeId<->line). */
  onToggleNodeBreakpoint?: (nodeId: string) => void;
  /** The node the debug session is currently paused ON, or null — glows it. */
  pausedNodeId?: string | null;
  onDrop: (e: React.DragEvent) => void;
  onDropOnEdge: (edgeId: string, e: React.DragEvent) => void;
  /** Edge highlighted while dragging an existing silo node over it. */
  pointerInsertEdgeId?: string | null;
  onClearConnecting: () => void;
  onNodeClick: (id: string) => void;
  onNodePointerDown: (e: React.PointerEvent, node: DarNode) => void;
  onConnectFrom: (id: string) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
  onEnterContainer: (id: string) => void;
  onAddParallelBranch: (nodeId: string) => void;
  onDeleteParallelBranch: (nodeId: string, branchId: string) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onAutoFit: () => void;
  onAutoLayout: () => void;
  /** Whether "auto-arrange on change" is currently locked ON. */
  layoutLocked: boolean;
  /** Toggle the "auto-arrange on change" lock. */
  onToggleLayoutLock: () => void;
  direction: "TB" | "LR";
  onSetDirection: (d: "TB" | "LR") => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  // Edge currently under a palette drag (drop here to insert a node on it).
  const [insertEdgeId, setInsertEdgeId] = useState<string | null>(null);
  // Measured card heights (cards use minHeight and can grow — parallel
  // branches, job params). Anchors/handles must sit on the REAL border.
  const heightsRef = useRef(new Map<string, number>());
  const [, bumpHeights] = useState(0);
  const resizeObs = useRef<ResizeObserver | null>(null);
  if (resizeObs.current === null && typeof ResizeObserver !== "undefined") {
    resizeObs.current = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const id = el.dataset.nodeId;
        if (!id) continue;
        if (heightsRef.current.get(id) !== el.offsetHeight) {
          heightsRef.current.set(id, el.offsetHeight);
          changed = true;
        }
      }
      if (changed) bumpHeights((v) => v + 1);
    });
  }
  const measureCard = (id: string) => (el: HTMLDivElement | null) => {
    if (!el) return;
    el.dataset.nodeId = id;
    if (heightsRef.current.get(id) !== el.offsetHeight) {
      heightsRef.current.set(id, el.offsetHeight);
      bumpHeights((v) => v + 1);
    }
    resizeObs.current?.observe(el);
  };
  const heights = heightsRef.current;
  const cardHeight = (id: string) => heights.get(id) ?? NODE_H;
  // Clicked/selected edge — its ✕ delete handle is only shown while selected,
  // keeping the canvas uncluttered.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // Drag-to-connect in progress: source node + the cursor in world coords.
  // A temporary dashed edge is drawn from the source anchor to the cursor.
  const [connectDrag, setConnectDrag] = useState<{
    sourceId: string;
    x: number;
    y: number;
  } | null>(null);
  /** Client → model-space coords (same math as node dragging: scroll + zoom,
   *  then shifted back by the world origin so this matches node.position). */
  const worldPoint = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left + canvas.scrollLeft) / zoom - WORLD_ORIGIN_X,
      y: (e.clientY - rect.top + canvas.scrollTop) / zoom - WORLD_ORIGIN_Y,
    };
  };
  // Selecting a node (or the background) deselects any selected edge.
  const onNodeClick = (id: string) => {
    setSelectedEdgeId(null);
    onNodeClickProp(id);
  };
  // Node-breakpoint helpers: which nodes currently have a breakpoint, and the
  // toggle handler (suppressed when the host can't register breakpoints, so no
  // dot invites a click that can't work — mirrors the code view's gutter).
  const bpNodeIds = new Set(breakpointNodeIds ?? []);
  const nodeBpToggleFor = (kind: string) =>
    breakpointsSupported === false || !nodeCanBreak(kind)
      ? undefined
      : onToggleNodeBreakpoint;
  // DAG root/leaf indicators. In a dag scope, a ROOT task has no incoming flow
  // edge (nothing runs before it — the SDK's `deps: []`) and a LEAF task has no
  // outgoing flow edge (nothing runs after it — the DAG drains at its leaves).
  // `flowEdges()` excludes error edges, matching how codegen classifies roots.
  // Both sets stay empty in linear scopes, so the caps never render there.
  const isDagScope = wf.dependencyMode === "dag";
  const dagFlow = isDagScope ? flowEdges(wf.edges) : [];
  const dagFlowTargets = new Set(dagFlow.map((e) => e.target));
  const dagFlowSources = new Set(dagFlow.map((e) => e.source));
  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      {/* Running-node indicator. A paused debugger has ONE node executing, and
          it needs to read as alive rather than merely selected — so the node
          keeps its solid yellow edge and gains a highlight that ORBITS its
          border, plus a slow breathing halo.

          The ring is a conic gradient on a ::before, masked so ONLY the ring
          itself is ever painted: `mask-composite: exclude` subtracts the
          content box from the padding box, leaving a 2px band that traces the
          node's outline. Rotating the gradient's angle (via an @property-typed
          custom property, since bare custom properties aren't interpolatable)
          sweeps a bright comet around that band.

          This deliberately replaces an earlier four-dashed-edges "marching
          ants" version: those gradients belonged to a box that overlapped the
          node's interior at the rounded corners, so the motion read as
          travelling ACROSS the node instead of around its border. A masked ring
          can only ever paint the border band, and needs no per-shape variant —
          circles and rounded cards differ by border-radius alone. */}
      <style>{`
        @property --wf-orbit {
          syntax: "<angle>";
          inherits: false;
          initial-value: 0deg;
        }
        @keyframes wf-running-orbit {
          to { --wf-orbit: 360deg; }
        }
        @keyframes wf-running-halo {
          0%, 100% { box-shadow: 0 0 0 3px rgba(255,214,0,0.30), 0 2px 6px rgba(0,0,0,0.4); }
          50%      { box-shadow: 0 0 0 7px rgba(255,214,0,0.10), 0 2px 6px rgba(0,0,0,0.4); }
        }
        .wf-running { animation: wf-running-halo 2s ease-in-out infinite; }
        .wf-running::before {
          content: "";
          position: absolute;
          inset: -4px;
          box-sizing: border-box;
          padding: 2px;
          border-radius: inherit;
          pointer-events: none;
          /* A dim ring all the way round so the outline is always readable,
             with a bright head trailing off — that contrast is what makes the
             sweep legible as motion rather than a uniform glow. */
          background: conic-gradient(
            from var(--wf-orbit),
            rgba(255,214,0,0.10) 0deg,
            rgba(255,214,0,0.10) 250deg,
            rgba(255,214,0,0.55) 320deg,
            #fff8c4 352deg,
            ${PAUSED_YELLOW} 358deg,
            rgba(255,214,0,0.10) 360deg
          );
          -webkit-mask:
            linear-gradient(#000 0 0) content-box,
            linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask:
            linear-gradient(#000 0 0) content-box,
            linear-gradient(#000 0 0);
          mask-composite: exclude;
          animation: wf-running-orbit 1.8s linear infinite;
        }
        /* Corner radius has to clear the -4px inset, so the card's 8px becomes
           12px; a circle stays a circle at any size. */
        .wf-running-rect::before { border-radius: 12px; }
        .wf-running-circle::before { border-radius: 50%; }
        /* Respect a reduced-motion preference: keep the ring, drop the motion. */
        @media (prefers-reduced-motion: reduce) {
          .wf-running,
          .wf-running::before { animation: none; }
          .wf-running::before { background: ${PAUSED_YELLOW}; }
        }
      `}</style>
      <div
        ref={canvasRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => {
          setSelectedEdgeId(null);
          onClearConnecting();
        }}
        style={{
          position: "relative",
          height: canvasHeight,
          overflow: "auto",
          background: "#0d1117 radial-gradient(#21262d 1px, transparent 1px)",
          backgroundSize: "20px 20px",
          border: "1px solid #30363d",
          borderRadius: 8,
        }}
      >
        <div
          style={{
            position: "relative",
            width: WORLD_W,
            height: WORLD_H,
            transform: `scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {/* Edges */}
          <svg
            style={{
              position: "absolute",
              inset: 0,
              width: WORLD_W,
              height: WORLD_H,
              pointerEvents: "none",
            }}
          >
            <defs>
              <marker
                id="dar-arrow"
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill="#8b949e" />
              </marker>
              <marker
                id="dar-arrow-red"
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill="#f85149" />
              </marker>
              <marker
                id="dar-arrow-green"
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill="#3fb950" />
              </marker>
            </defs>
            {wf.edges.map((edge) => {
              const s = byId.get(edge.source);
              const t = byId.get(edge.target);
              if (!s || !t) return null;
              const a = anchorsFor(s, t, direction, heights);
              const isErrEdge = edge.kind === "error";
              // DAG ordering-only edges (the SDK's .after()) read as a distinct
              // dotted line so they're clearly "wait, but pass no value". The
              // kind is auto-inferred (shared with codegen) unless the edge has
              // an explicit override. Condition-source edges are routing (never
              // ordering), matching how codegen classifies them.
              const isOrdering =
                !isErrEdge &&
                wf.dependencyMode === "dag" &&
                s.kind !== "condition" &&
                inferDependencyKind({
                  targetNode: t as unknown as Record<string, unknown>,
                  sourceName: s.name,
                  explicit: edge.dependencyKind,
                }) === "ordering";
              // Highlight edges between two error nodes (captures cycle edges).
              const isErr =
                isErrEdge ||
                (errorNodeIds.has(edge.source) &&
                  errorNodeIds.has(edge.target));
              const d = edgePathFor(a, direction);
              const isSelected = selectedEdgeId === edge.id;
              const isInsertTarget =
                insertEdgeId === edge.id || pointerInsertEdgeId === edge.id;
              const strokeColor = isInsertTarget
                ? "#3fb950"
                : isErr
                  ? "#f85149"
                  : isSelected
                    ? "#c9d1d9"
                    : "#8b949e";
              const { mx, my } = edgeMid(a, direction);
              return (
                <Fragment key={edge.id}>
                  <path
                    d={d}
                    stroke={strokeColor}
                    strokeWidth={isInsertTarget || isSelected ? 3.5 : 2}
                    strokeDasharray={
                      isErrEdge ? "5,4" : isOrdering ? "2,4" : undefined
                    }
                    fill="none"
                    markerEnd={
                      isInsertTarget
                        ? "url(#dar-arrow-green)"
                        : isErr
                          ? "url(#dar-arrow-red)"
                          : "url(#dar-arrow)"
                    }
                  />
                  {/* Invisible wide hit path: click to select the edge (shows
                      its delete handle); on non-error edges also a drop target
                      to insert a palette node onto the edge (A→X→B). Error
                      edges take no insert (splitting one into flow edges
                      would break its on-failure semantics). */}
                  <path
                    d={d}
                    stroke="transparent"
                    strokeWidth={36}
                    strokeLinecap="round"
                    fill="none"
                    style={{ pointerEvents: "stroke", cursor: "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedEdgeId((cur) =>
                        cur === edge.id ? null : edge.id,
                      );
                    }}
                    onDragOver={(e) => {
                      if (
                        !isErrEdge &&
                        e.dataTransfer.types.includes("application/dar-node")
                      ) {
                        e.preventDefault();
                        e.stopPropagation();
                        setInsertEdgeId(edge.id);
                      }
                    }}
                    onDragLeave={() =>
                      setInsertEdgeId((cur) => (cur === edge.id ? null : cur))
                    }
                    onDrop={(e) => {
                      if (isErrEdge) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setInsertEdgeId(null);
                      onDropOnEdge(edge.id, e);
                    }}
                  />
                  {/* Delete handle for the selected edge: a filled disc in the
                      edge's own color with a scissor-cut ✕, drawn in the same
                      SVG so it visually belongs to the line. */}
                  {isSelected && (
                    <g
                      // The edge <svg> is pointerEvents:none (hit paths opt in
                      // with "stroke") — opt the handle in too, or clicks fall
                      // through to the toggle path underneath.
                      style={{ cursor: "pointer", pointerEvents: "all" }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedEdgeId(null);
                        onDeleteEdge(edge.id);
                      }}
                    >
                      <title>Delete connection</title>
                      <circle
                        cx={mx}
                        cy={my}
                        r={9}
                        fill={strokeColor}
                        stroke="#0d1117"
                        strokeWidth={1.5}
                      />
                      <path
                        d={`M${mx - 3.2},${my - 3.2} L${mx + 3.2},${my + 3.2} M${mx - 3.2},${my + 3.2} L${mx + 3.2},${my - 3.2}`}
                        stroke="#0d1117"
                        strokeWidth={2.2}
                        strokeLinecap="round"
                        fill="none"
                      />
                    </g>
                  )}
                </Fragment>
              );
            })}
            {/* Temporary connect edge: source anchor → cursor, dashed green so
                it clearly reads as "not committed yet". */}
            {connectDrag &&
              (() => {
                const s = byId.get(connectDrag.sourceId);
                if (!s) return null;
                const a = anchorsFor(s, s, direction, heights);
                const d = edgePathFor(
                  {
                    x1: a.x1,
                    y1: a.y1,
                    x2: connectDrag.x + WORLD_ORIGIN_X,
                    y2: connectDrag.y + WORLD_ORIGIN_Y,
                  },
                  direction,
                );
                return (
                  <path
                    d={d}
                    stroke="#3fb950"
                    strokeWidth={2.5}
                    strokeDasharray="6,4"
                    fill="none"
                    markerEnd="url(#dar-arrow-green)"
                  />
                );
              })()}
          </svg>

          {/* Edge badges (condition match / error type) at the curve's true
              midpoint. The delete handle is drawn in the SVG edge layer. */}
          {wf.edges.map((edge) => {
            const s = byId.get(edge.source);
            const t = byId.get(edge.target);
            if (!s || !t) return null;
            const { mx, my } = edgeMid(anchorsFor(s, t, direction, heights), direction);
            const isErrEdge = edge.kind === "error";
            // Show the match on condition edges (a matchless condition edge is
            // the "else" branch) and the error type on error edges.
            const hasMatch = !!(edge.match && edge.match.trim());
            const isCondEdge = s.kind === "condition" && !isErrEdge;
            const isOrdering =
              !isErrEdge &&
              wf.dependencyMode === "dag" &&
              !isCondEdge &&
              inferDependencyKind({
                targetNode: t as unknown as Record<string, unknown>,
                sourceName: s.name,
                explicit: edge.dependencyKind,
              }) === "ordering";
            const badgeText = isErrEdge
              ? (edge.errorType ?? "").trim() || "any error"
              : isOrdering
                ? "after"
                : hasMatch
                  ? edge.match
                  : isCondEdge
                    ? "else"
                    : null;
            const badgeColor = isErrEdge
              ? "#f85149"
              : isOrdering
                ? "#8b949e"
                : hasMatch
                  ? KIND_COLORS.condition
                  : "#8b949e";
            return (
              <Fragment key={edge.id}>
                {badgeText ? (
                  <div
                    style={{
                      position: "absolute",
                      left: mx,
                      top: my - 24,
                      transform: "translateX(-50%)",
                      maxWidth: 160,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      background: "#161b22",
                      border: `1px solid ${badgeColor}`,
                      color: badgeColor,
                      borderRadius: 4,
                      padding: "1px 6px",
                      fontSize: 10,
                      fontFamily: "monospace",
                      fontStyle: hasMatch || isErrEdge ? "normal" : "italic",
                      pointerEvents: "none",
                    }}
                  >
                    {badgeText}
                  </div>
                ) : null}
              </Fragment>
            );
          })}

          {/* Nodes */}
          {wf.nodes.map((node) => {
            const isSel = node.id === selectedId;
            const isConnSrc = node.id === connectingFrom;
            const isErr = errorNodeIds.has(node.id);
            // The debug session is paused ON this node (its decl line == the
            // paused line): a distinct yellow outline + glow, matching the
            // code view's paused-line color.
            const isPaused = pausedNodeId === node.id;
            // DAG-only root/leaf caps (this card path is never a start/end,
            // which return above — so every card here is an operation task).
            // ROOT: no incoming flow edge ("no node before"); LEAF: no outgoing
            // flow edge ("no node after"). A lone task is BOTH. Never shown in
            // linear scopes (the sets are empty there).
            const isDagRoot = isDagScope && !dagFlowTargets.has(node.id);
            const isDagLeaf = isDagScope && !dagFlowSources.has(node.id);
            // Start marker: a green circle (mirroring the end circle) with a
            // connect affordance, so it reads distinctly from the rectangular
            // primitive cards.
            if (node.kind === "start") {
              const D = START_D;
              return (
                <div
                  key={node.id}
                  style={{
                    position: "absolute",
                    left: node.position.x + WORLD_ORIGIN_X,
                    top: node.position.y + WORLD_ORIGIN_Y + NODE_H / 2 - D / 2,
                    width: NODE_W,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                  }}
                >
                  <BreakpointDot
                    nodeId={node.id}
                    active={bpNodeIds.has(node.id)}
                    onToggle={nodeBpToggleFor(node.kind)}
                    style={{
                      position: "absolute",
                      top: -3,
                      left: (NODE_W - D) / 2 - 3,
                      zIndex: 2,
                    }}
                  />
                  <div
                    title={node.name || "start"}
                    className={isPaused ? "wf-running wf-running-circle" : undefined}
                    onPointerDown={(e) => onNodePointerDown(e, node)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onNodeClick(node.id);
                    }}
                    style={{
                      // The ring is a ::before at inset -5px, so this element
                      // has to be a positioning context (the card and the end
                      // circle already are, being absolutely placed).
                      position: "relative",
                      width: D,
                      height: D,
                      boxSizing: "border-box",
                      borderRadius: "50%",
                      background: KIND_COLORS.start,
                      border: `2px solid ${
                        isPaused
                          ? PAUSED_YELLOW
                          : isSel
                            ? "#e6edf3"
                            : isErr
                              ? "#f0b429"
                              : "#30363d"
                      }`,
                      boxShadow: isPaused
                        ? `0 0 0 3px rgba(255,214,0,0.35), 0 2px 6px rgba(0,0,0,0.4)`
                        : "0 2px 6px rgba(0,0,0,0.4)",
                      color: "#0d1117",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 0.4,
                      cursor: connectingFrom ? "crosshair" : "grab",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      style={{ display: "block" }}
                      aria-label="start"
                    >
                      <path d="M5 3.5 L12 8 L5 12.5 Z" fill="#0d1117" />
                    </svg>
                  </div>
                </div>
              );
            }
            // End nodes are pure sink markers (no actions) — render a small
            // circle centered at the box's top-center so incoming edges hit it.
            if (node.kind === "end") {
              const D = 44;
              return (
                <div
                  key={node.id}
                  title={node.name || "end"}
                  className={isPaused ? "wf-running wf-running-circle" : undefined}
                  onPointerDown={(e) => onNodePointerDown(e, node)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onNodeClick(node.id);
                  }}
                  style={{
                    position: "absolute",
                    left: node.position.x + WORLD_ORIGIN_X + NODE_W / 2 - D / 2,
                    top: node.position.y + WORLD_ORIGIN_Y + NODE_H / 2 - D / 2,
                    width: D,
                    height: D,
                    boxSizing: "border-box",
                    borderRadius: "50%",
                    background: KIND_COLORS.end,
                    border: `2px solid ${
                      isPaused
                        ? PAUSED_YELLOW
                        : isSel
                          ? "#e6edf3"
                          : isErr
                            ? "#f0b429"
                            : "#30363d"
                    }`,
                    boxShadow: isPaused
                      ? `0 0 0 3px rgba(255,214,0,0.35), 0 2px 6px rgba(0,0,0,0.4)`
                      : "0 2px 6px rgba(0,0,0,0.4)",
                    color: "#0d1117",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 0.4,
                    cursor: connectingFrom ? "crosshair" : "grab",
                  }}
                >
                  <BreakpointDot
                    nodeId={node.id}
                    active={bpNodeIds.has(node.id)}
                    onToggle={nodeBpToggleFor(node.kind)}
                    style={{
                      position: "absolute",
                      top: -3,
                      left: -3,
                      zIndex: 2,
                    }}
                  />
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    style={{ display: "block" }}
                    aria-label="end"
                  >
                    <rect x="4" y="4" width="8" height="8" rx="1" fill="#0d1117" />
                  </svg>
                </div>
              );
            }
            return (
              <div
                key={node.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onNodeClick(node.id);
                }}
                onDoubleClick={
                  isContainerKind(node.kind)
                    ? (e) => {
                        e.stopPropagation();
                        // Parallel levels are keyed by branch id, so open the
                        // first branch; map/group bodies are keyed by node id.
                        if (node.kind === "parallel") {
                          const first = node.branches[0];
                          if (first) onEnterContainer(first.id);
                        } else {
                          onEnterContainer(node.id);
                        }
                      }
                    : undefined
                }
                ref={measureCard(node.id)}
                className={isPaused ? "wf-running wf-running-rect" : undefined}
                style={{
                  position: "absolute",
                  left: node.position.x + WORLD_ORIGIN_X,
                  top: node.position.y + WORLD_ORIGIN_Y,
                  width: NODE_W,
                  minHeight: NODE_H,
                  background: "#161b22",
                  border: `2px solid ${isPaused ? PAUSED_YELLOW : isErr ? "#f85149" : isSel ? KIND_COLORS[node.kind] : isConnSrc ? "#f0b429" : "#30363d"}`,
                  borderRadius: 8,
                  boxShadow: isPaused
                    ? `0 0 0 3px rgba(255,214,0,0.35), 0 2px 6px rgba(0,0,0,0.4)`
                    : "0 2px 6px rgba(0,0,0,0.4)",
                  color: "#e6edf3",
                  cursor: connectingFrom ? "crosshair" : "pointer",
                }}
              >
                <div
                  onPointerDown={(e) => onNodePointerDown(e, node)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "4px 8px",
                    background: KIND_COLORS[node.kind],
                    borderTopLeftRadius: 6,
                    borderTopRightRadius: 6,
                    cursor: "grab",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#0d1117",
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      overflow: "hidden",
                    }}
                  >
                    <BreakpointDot
                      nodeId={node.id}
                      active={bpNodeIds.has(node.id)}
                      onToggle={nodeBpToggleFor(node.kind)}
                    />
                    <Icon name={NODE_ICONS[node.kind]} size="small" />
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {node.kind === "awsJob"
                        ? (getServiceIntegration(
                            (node as { integration?: string }).integration,
                          )?.shortLabel ?? NODE_KIND_LABELS[node.kind])
                        : node.kind === "awsSdkCall"
                          ? ((node as { command?: string }).command?.replace(
                              /Command$/,
                              "",
                            ) ?? NODE_KIND_LABELS[node.kind])
                          : node.kind === "httpCall"
                            ? httpCallSubtitle(node)
                            : NODE_KIND_LABELS[node.kind]}
                    </span>
                  </span>
                  <span
                    role="button"
                    title="Delete node"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteNode(node.id);
                    }}
                    style={{ cursor: "pointer", fontWeight: 700 }}
                  >
                    ✕
                  </span>
                </div>
                <div style={{ padding: "6px 8px" }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {node.name || "(unnamed)"}
                  </div>
                  {/* DAG: badge a non-default trigger rule so re-convergence
                      semantics are visible on the graph (P3.5). */}
                  {wf.dependencyMode === "dag" &&
                    node.triggerRule &&
                    node.triggerRule !== "ALL_SUCCESS" && (
                      <div style={{ marginTop: 4 }}>
                        <span
                          title={`Trigger rule: ${node.triggerRule}`}
                          style={{
                            display: "inline-block",
                            maxWidth: "100%",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            background: "#0d1117",
                            border: "1px solid #a855f7",
                            color: "#c9a2f7",
                            borderRadius: 4,
                            padding: "0 6px",
                            fontSize: 10,
                            fontFamily: "monospace",
                          }}
                        >
                          {node.triggerRule}
                        </span>
                      </div>
                    )}
                  {(node.kind === "map" ||
                    node.kind === "group" ||
                    node.kind === "dagContainer") &&
                    (() => {
                      const count = node.body.nodes.filter(
                        (n) => n.kind !== "start" && n.kind !== "end",
                      ).length;
                      const label =
                        node.kind === "map"
                          ? "iteration body"
                          : node.kind === "dagContainer"
                            ? "DAG body"
                            : "body";
                      return (
                        <div style={{ marginTop: 6 }}>
                          <div
                            title="Open body"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEnterContainer(node.id);
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 6,
                              padding: "3px 6px",
                              background: "#0d1117",
                              border: "1px solid #30363d",
                              borderRadius: 4,
                              fontSize: 11,
                              cursor: "pointer",
                            }}
                          >
                            <span>{label}</span>
                            <span style={{ color: "#8b949e", flexShrink: 0 }}>
                              {count} {count === 1 ? "node" : "nodes"}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  {node.kind === "parallel" && (
                    <div
                      style={{
                        marginTop: 6,
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      {node.branches.map((b) => {
                        const count = b.body.nodes.filter(
                          (n) => n.kind !== "start" && n.kind !== "end",
                        ).length;
                        return (
                          <div
                            key={b.id}
                            title="Open branch"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEnterContainer(b.id);
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 6,
                              padding: "3px 6px",
                              background: "#0d1117",
                              border: "1px solid #30363d",
                              borderRadius: 4,
                              fontSize: 11,
                              cursor: "pointer",
                            }}
                          >
                            <span
                              style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {b.name || "(unnamed)"}
                            </span>
                            <span
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                color: "#8b949e",
                                flexShrink: 0,
                              }}
                            >
                              <span>
                                {count} {count === 1 ? "node" : "nodes"}
                              </span>
                              <span
                                role="button"
                                title="Remove branch"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (node.branches.length > 1)
                                    onDeleteParallelBranch(node.id, b.id);
                                }}
                                style={{
                                  cursor:
                                    node.branches.length > 1
                                      ? "pointer"
                                      : "not-allowed",
                                  opacity: node.branches.length > 1 ? 1 : 0.4,
                                }}
                              >
                                ✕
                              </span>
                            </span>
                          </div>
                        );
                      })}
                      <div
                        role="button"
                        title="Add branch"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddParallelBranch(node.id);
                        }}
                        style={{
                          padding: "3px 6px",
                          border: "1px dashed #30363d",
                          borderRadius: 4,
                          fontSize: 11,
                          color: "#8b949e",
                          cursor: "pointer",
                          textAlign: "center",
                        }}
                      >
                        + branch
                      </div>
                    </div>
                  )}
                  {node.kind === "condition" ? (
                    <div
                      style={{ marginTop: 4, fontSize: 11, color: "#8b949e" }}
                    >
                      branches: {wf.edges.filter((e) => e.source === node.id).length}
                    </div>
                  ) : null}
                </div>
                {/* DAG root/leaf markers attached OUTSIDE the card: a tab on
                    the top edge (root — no node before) and the bottom edge
                    (leaf — no node after). Non-interactive; dag scopes only. */}
                {isDagRoot && (
                  <span
                    title="Root task — no dependencies (nothing runs before it)"
                    style={{
                      position: "absolute",
                      top: -11,
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: "#0d1117",
                      border: `1px solid ${KIND_COLORS.start}`,
                      color: KIND_COLORS.start,
                      borderRadius: 4,
                      padding: "0 6px",
                      fontSize: 10,
                      lineHeight: "16px",
                      fontFamily: "monospace",
                      pointerEvents: "none",
                      zIndex: 3,
                    }}
                  >
                    root
                  </span>
                )}
                {isDagLeaf && (
                  <span
                    title="Leaf task — nothing runs after it (the DAG drains here)"
                    style={{
                      position: "absolute",
                      bottom: -11,
                      right: 8,
                      background: "#0d1117",
                      border: `1px solid ${KIND_COLORS.end}`,
                      color: KIND_COLORS.end,
                      borderRadius: 4,
                      padding: "0 6px",
                      fontSize: 10,
                      lineHeight: "16px",
                      fontFamily: "monospace",
                      pointerEvents: "none",
                      zIndex: 3,
                    }}
                  >
                    leaf
                  </span>
                )}
              </div>
            );
          })}

          {/* Connect handles: a port-style disc at each node's exact
              edge-start anchor (bottom-center in TB, right-center in LR).
              Drag it onto a target node to connect; a dashed green preview
              edge follows the cursor. */}
          {wf.nodes.map((node) => {
            if (node.kind === "end" || node.kind === "condition") return null;
            const a = anchorsFor(node, node, direction, heights);
            const active = connectDrag?.sourceId === node.id;
            const H = 16;
            return (
              <div
                key={`connect-${node.id}`}
                role="button"
                title="Drag to connect to another node"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  onConnectFrom(node.id);
                  setConnectDrag({ sourceId: node.id, ...worldPoint(e) });
                }}
                onPointerMove={(e) => {
                  if (connectDrag?.sourceId === node.id) {
                    setConnectDrag({ sourceId: node.id, ...worldPoint(e) });
                  }
                }}
                onPointerUp={(e) => {
                  if (connectDrag?.sourceId !== node.id) return;
                  const p = worldPoint(e);
                  setConnectDrag(null);
                  const target = wf.nodes.find(
                    (n) =>
                      n.id !== node.id &&
                      n.kind !== "start" &&
                      p.x >= n.position.x &&
                      p.x <= n.position.x + NODE_W &&
                      p.y >= n.position.y &&
                      p.y <= n.position.y + cardHeight(n.id),
                  );
                  // Dropping on a target connects (the hook's connect mode
                  // adds the edge); anywhere else cancels.
                  if (target) onNodeClick(target.id);
                  else onClearConnecting();
                }}
                style={{
                  position: "absolute",
                  left: a.x1 - H / 2,
                  top: a.y1 - H / 2,
                  width: H,
                  height: H,
                  borderRadius: H / 2,
                  boxSizing: "border-box",
                  background: active ? "#3fb950" : "#161b22",
                  border: `1.5px solid ${active ? "#3fb950" : "#8b949e"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: active ? "grabbing" : "grab",
                  touchAction: "none",
                }}
              >
                <svg width="10" height="10" viewBox="0 0 16 16">
                  <path
                    d="M8 2.5 v9 M4 8 l4 4 4 -4"
                    fill="none"
                    stroke={active ? "#0d1117" : "#c9d1d9"}
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    transform={
                      direction === "LR" ? "rotate(-90 8 8)" : undefined
                    }
                  />
                </svg>
              </div>
            );
          })}

          {wf.nodes.length === 0 && (
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%,-50%)",
                color: "#8b949e",
                fontSize: 13,
                textAlign: "center",
                pointerEvents: "none",
              }}
            >
              Drag a primitive here (or click one on the left) to start building.
            </div>
          )}
        </div>
      </div>

      {/* Zoom toolbar (fixed overlay, doesn't scale with the canvas). */}
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          gap: 2,
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 6,
          padding: 2,
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
        <button
          type="button"
          className="wf-tip"
          data-tip="Undo"
          title="Undo"
          onClick={onUndo}
          disabled={!canUndo}
          style={zoomBtnStyle}
        >
          ↶
        </button>
        <button
          type="button"
          className="wf-tip"
          data-tip="Redo"
          title="Redo"
          onClick={onRedo}
          disabled={!canRedo}
          style={zoomBtnStyle}
        >
          ↷
        </button>
        <span
          style={{
            width: 1,
            alignSelf: "stretch",
            margin: "2px 2px",
            background: "#30363d",
          }}
        />
        <button
          type="button"
          className="wf-tip"
          data-tip="Zoom out"
          title="Zoom out"
          onClick={onZoomOut}
          disabled={zoom <= MIN_ZOOM}
          style={zoomBtnStyle}
        >
          −
        </button>
        <span
          style={{
            minWidth: 40,
            textAlign: "center",
            fontSize: 12,
            color: "#e6edf3",
          }}
        >
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          className="wf-tip"
          data-tip="Zoom in"
          title="Zoom in"
          onClick={onZoomIn}
          disabled={zoom >= MAX_ZOOM}
          style={zoomBtnStyle}
        >
          +
        </button>
        <button
          type="button"
          className="wf-tip"
          data-tip="Fit to view"
          title="Fit to view"
          onClick={onAutoFit}
          style={zoomBtnStyle}
        >
          ⤢
        </button>
        <button
          type="button"
          className="wf-tip"
          data-tip="Auto-arrange layout"
          title="Auto-arrange layout"
          onClick={onAutoLayout}
          disabled={wf.nodes.length === 0}
          style={zoomBtnStyle}
        >
          {/* Layout glyph: a 2x2 grid of tiles (the shared "layout" base) with
              a small sparkle mark = "auto" arrange. */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="1" y="4" width="5" height="5" rx="1" fill="currentColor" />
            <rect x="8" y="4" width="5" height="5" rx="1" fill="currentColor" />
            <rect x="1" y="11" width="5" height="5" rx="1" fill="currentColor" />
            <rect x="8" y="11" width="5" height="5" rx="1" fill="currentColor" />
            {/* sparkle = automatic */}
            <path
              d="M12 0.5L12.7 2.3L14.5 3L12.7 3.7L12 5.5L11.3 3.7L9.5 3L11.3 2.3Z"
              fill="currentColor"
            />
          </svg>
        </button>
        <button
          type="button"
          className="wf-tip"
          data-tip={
            layoutLocked
              ? "Auto-arrange on changes: ON (click to unlock)"
              : "Auto-arrange on changes: OFF (click to lock)"
          }
          title={
            layoutLocked
              ? "Auto-arrange on changes: ON (click to unlock)"
              : "Auto-arrange on changes: OFF (click to lock)"
          }
          aria-pressed={layoutLocked}
          onClick={onToggleLayoutLock}
          style={
            layoutLocked
              ? {
                  ...zoomBtnStyle,
                  color: "#58a6ff",
                  borderColor: "#1f6feb",
                  background: "#132030",
                }
              : zoomBtnStyle
          }
        >
          {/* Same 2x2 layout base as the auto-arrange icon, with a padlock
              mark: closed shackle when locked, open when unlocked. */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="1" y="4" width="5" height="5" rx="1" fill="currentColor" />
            <rect x="8" y="4" width="5" height="5" rx="1" fill="currentColor" />
            <rect x="1" y="11" width="5" height="5" rx="1" fill="currentColor" />
            <rect x="8" y="11" width="5" height="5" rx="1" fill="currentColor" />
            {/* padlock mark (top-right). Shackle path differs by lock state. */}
            <path
              d={
                layoutLocked
                  ? "M10 2.2V1.4A1.6 1.6 0 0 1 13.2 1.4V2.2"
                  : "M10 2.2V1.4A1.6 1.6 0 0 1 13.2 1.4V0.8"
              }
              stroke="currentColor"
              strokeWidth="1"
              fill="none"
            />
            <rect x="9.2" y="2.2" width="4.8" height="3.6" rx="0.8" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className="wf-tip"
          data-tip={
            direction === "LR"
              ? "Direction: left-to-right (click for top-to-bottom)"
              : "Direction: top-to-bottom (click for left-to-right)"
          }
          title="Layout direction"
          onClick={() => onSetDirection(direction === "TB" ? "LR" : "TB")}
          style={{ ...zoomBtnStyle, width: "auto", padding: "0 8px", fontSize: 13 }}
        >
          {direction === "LR" ? "→" : "↓"}
        </button>
      </div>
    </div>
  );
}
