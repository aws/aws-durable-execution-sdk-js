/**
 * Core structural primitives of the visual Workflow Studio `.dar` model, shared
 * by the Studio authoring model and the CDK code generator so the two cannot
 * drift. Each package layers its own richer `DarNode`/`DarWorkflow` view on top.
 */

/** All node kinds a `.dar` workflow can contain (runtime list). */
export const DAR_NODE_KINDS = [
  "start",
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
  "awsJob",
  "awsSdkCall",
  "httpCall",
  "end",
] as const;

/** The kinds of node a `.dar` workflow can contain. */
export type DarNodeKind = (typeof DAR_NODE_KINDS)[number];

/** Canvas position of a node. */
export interface DarPosition {
  x: number;
  y: number;
}

/** Routing kind of an edge: normal control flow or an error route. */
export type DarEdgeKind = "flow" | "error";

/**
 * How an edge feeds its target in `dag` dependency mode:
 *   - `"result"` (default when absent) — the source task's result is passed
 *     into the target's `deps` map (`deps["<source>"]`), i.e. a data
 *     dependency.
 *   - `"ordering"` — a wait-only dependency (the SDK's `.after()`): the target
 *     waits for the source to settle but receives **no** result in `deps`.
 *
 * Ignored in `linear` mode (edges there are always plain control flow).
 */
export type DarEdgeDependencyKind = "result" | "ordering";

/**
 * A directed connection between two nodes — the **only** carrier of routing in
 * a `.dar` workflow (nodes never route; see the format spec's "every
 * transition is an edge" principle).
 */
export interface DarEdge {
  id: string;
  source: string;
  target: string;
  /**
   * Routing kind; absent = `"flow"`. An `"error"` edge runs when its source
   * node fails (after retries): the failing node's `catch` routes here.
   */
  kind?: DarEdgeKind;
  /**
   * For edges out of a `condition` node: the value to match against the
   * condition's result. An edge without `match` is the default/else branch.
   */
  match?: string;
  /**
   * For `"error"` edges: the error class matched via `instanceof`. Absent or
   * blank = catch-all.
   */
  errorType?: string;
  /**
   * In `dag` dependency mode, how this edge feeds its target: `"result"`
   * (default when absent) passes the source task's result into the target's
   * `deps` map; `"ordering"` is a wait-only edge (the SDK's `.after()`) that
   * injects no result. Ignored in `linear` mode. See
   * {@link DarEdgeDependencyKind}.
   */
  dependencyKind?: DarEdgeDependencyKind;
  /** Optional display-only label. Carries no routing semantics. */
  label?: string;
}

/**
 * One error **fallback** of a node: matches an error type (blank/undefined =
 * catch-all) and supplies a fallback value (`fallbackCode`, a block returning
 * the result). Error **routes** are `"error"`-kind edges, not branches — a
 * fallback has no destination, so it stays on the node.
 */
export interface ErrorBranch {
  id: string;
  errorType?: string;
  fallbackCode?: string;
}

/**
 * How many next nodes a node may fan out to: `linear` (1:1) or `dag`
 * (multiple), enforced per-workflow.
 */
export type DependencyMode = "linear" | "dag";

/** Edges carrying normal control flow (i.e. not error routes). */
export function flowEdges(edges: readonly DarEdge[]): DarEdge[] {
  return edges.filter((e) => e.kind !== "error");
}

/**
 * Error-route edges out of a node, in array order — the order drives the
 * generated `err instanceof <Type>` chain, catch-all (no `errorType`) last.
 */
export function errorEdgesFor(
  edges: readonly DarEdge[],
  nodeId: string,
): DarEdge[] {
  return edges.filter((e) => e.kind === "error" && e.source === nodeId);
}
