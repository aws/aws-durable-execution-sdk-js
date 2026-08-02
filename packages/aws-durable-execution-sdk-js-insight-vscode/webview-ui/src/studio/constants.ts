/**
 * Shared layout/theme constants for the Workflow Studio canvas and its widgets.
 * Extracted from StudioPage.tsx so the individual studio components can import
 * them without depending on the page module.
 */
import type { CSSProperties } from "react";
import type { IconProps } from "@cloudscape-design/components/icon";
import type { DarNodeKind, DurationUnit, TriggerRule } from "../studioTypes";

/** Node card footprint (also used for edge-endpoint math). */
export const NODE_W = 190;
export const NODE_H = 72;

/** Zoom bounds/step for the canvas. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
export const ZOOM_STEP = 1.2;

/** The scrollable "world" the nodes live in; large enough to pan around. */
export const WORLD_W = 4000;
export const WORLD_H = 3000;

/**
 * The world div is a fixed, positive-only DOM box (browsers can't scroll to
 * negative offsets), but node positions are centered at (0,0) — the layout
 * puts a lone child directly under its parent and splits siblings ±. This
 * constant is the render-time offset between the two: DOM pixel = model
 * position + WORLD_ORIGIN. Applied at the two boundaries (rendering a node,
 * and converting a pointer event back to a model position) — everywhere else
 * keeps working in one consistent coordinate space.
 */
export const WORLD_ORIGIN_X = WORLD_W / 2;
export const WORLD_ORIGIN_Y = WORLD_H / 2;

export const clampZoom = (z: number): number =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Small square button used by the canvas zoom toolbar. */
export const zoomBtnStyle: CSSProperties = {
  width: 24,
  height: 24,
  lineHeight: "22px",
  textAlign: "center",
  padding: 0,
  fontSize: 15,
  cursor: "pointer",
  color: "#e6edf3",
  background: "#0d1117",
  border: "1px solid #30363d",
  borderRadius: 4,
};

/**
 * Palette primitives (start/end are not draggable: start is implicit and
 * single; end nodes appear when a node is marked terminal or a branch ends).
 */
export const KINDS: DarNodeKind[] = [
  "step",
  "inline",
  "wait",
  "callback",
  "chainInvoke",
  "waitForCondition",
  "condition",
  "map",
  "group",
  "dagContainer",
  "parallel",
];

/**
 * The kinds offered in the palette.
 *
 * `dagContainer` is the only way to author dag-mode tasks, and dag codegen calls a
 * runtime the SDK does not implement yet, so dragging one in produces a workflow
 * that cannot be deployed. It is hidden unless dag mode is explicitly enabled,
 * mirroring the starter packs marked `requiresDagRuntime`.
 *
 * This is the UI half only — codegen refuses independently (see
 * `emitDagRegistrations`), which is what actually protects a deploy. Hiding it
 * here just stops a user reaching a dead end from the palette.
 */
export function paletteKinds(dagEnabled: boolean): DarNodeKind[] {
  return dagEnabled ? KINDS : KINDS.filter((k) => k !== "dagContainer");
}

export const KIND_COLORS: Record<DarNodeKind, string> = {
  start: "#22c55e",
  step: "#3b82f6",
  inline: "#60a5fa",
  wait: "#a855f7",
  callback: "#f59e0b",
  chainInvoke: "#10b981",
  waitForCondition: "#ec4899",
  condition: "#eab308",
  map: "#06b6d4",
  group: "#6366f1",
  dagContainer: "#8b5cf6",
  parallel: "#14b8a6",
  awsJob: "#f97316",
  awsSdkCall: "#0ea5e9",
  httpCall: "#a855f7",
  end: "#ef4444",
};

/**
 * Node kind → Cloudscape icon name, shown on node cards and palette items.
 * (Cloudscape icons only — we deliberately don't vendor AWS console/service
 * SVGs, which are brand assets and not Apache-2.0 redistributable.)
 */
export const NODE_ICONS: Record<DarNodeKind, IconProps.Name> = {
  start: "play",
  step: "script",
  inline: "insert-row",
  wait: "status-pending",
  callback: "notification",
  chainInvoke: "external",
  waitForCondition: "refresh",
  condition: "share",
  map: "copy",
  group: "folder",
  dagContainer: "share",
  parallel: "view-vertical",
  awsJob: "settings",
  awsSdkCall: "call",
  httpCall: "external",
  end: "status-stopped",
};

export const DURATION_UNITS: DurationUnit[] = [
  "seconds",
  "minutes",
  "hours",
  "days",
];

/** Sentinel target value meaning "make this branch end the workflow". */
export const END_SENTINEL = "__END__";

/** Human labels for the six SDK trigger rules (inspector dropdown + DAG config
 *  panel). Keyed by the shared {@link TriggerRule} union. */
export const TRIGGER_RULE_LABELS: Record<TriggerRule, string> = {
  ALL_SUCCESS: "All dependencies succeed (default)",
  ALL_FAILED: "All dependencies failed",
  ALL_DONE: "All dependencies settled",
  ANY_SUCCESS: "Any dependency succeeds",
  ANY_FAILED: "Any dependency fails",
  NONE_FAILED: "All settled, none failed",
};
