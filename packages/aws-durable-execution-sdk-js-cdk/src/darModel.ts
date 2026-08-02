import { readFileSync } from "node:fs";
import {
  DAR_VERSION,
  migrateDar,
  type DarEdge,
  type DarNodeKind,
  type DarPosition,
  type DependencyMode,
  type ErrorBranch,
  type DagConfigSpec,
} from "@aws/durable-execution-sdk-js-visual-workflow-model";

// Re-export the shared primitives so existing `./darModel` imports keep working.
export type {
  DarEdge,
  DarNodeKind,
  DarPosition,
  DependencyMode,
  ErrorBranch,
  DagConfigSpec,
};

/**
 * Minimal read-only view of the Workflow Studio `.dar` model — only what the
 * CDK code generator needs. Structural primitives (kinds, edges, error
 * branches, positions, version) come from
 * `@aws/durable-execution-sdk-js-visual-workflow-model`; the Studio layers its
 * own richer authoring model on the same primitives.
 */
export interface DarNode {
  id: string;
  kind: DarNodeKind;
  name: string;
  position?: DarPosition;
  terminal?: boolean;
  /** step / condition / waitForCondition body, map itemsCode, etc. */
  code?: string;
  /** Error branches: on failure, matched by error type to a route or fallback. */
  onError?: ErrorBranch[];
  /** Additional kind-specific fields are read as needed by the generator. */
  [key: string]: unknown;
}

export interface DarWorkflow {
  darVersion: string;
  name: string;
  dependencyMode?: DependencyMode;
  /** TypeScript type of the execution input (`event`). Absent => `unknown`. */
  inputType?: string;
  /** Workflow-level DAG config; only meaningful when `dependencyMode: "dag"`. */
  dagConfig?: DagConfigSpec;
  nodes: DarNode[];
  edges: DarEdge[];
}

/**
 * A `dagContainer` node: a body-bearing container (like a `group`) whose inner
 * `body` scope is **always** `dependencyMode: "dag"`. It is the only mechanism
 * for nesting a DAG scope — `group`/`map`/`parallel` bodies are always
 * `"linear"`. In a LINEAR parent scope it emits `context.dag(...)`; in a DAG
 * parent scope it is a task emitting `dag.dag(name, deps, …)`. The body's
 * `dependencyMode` is derived from this structure (forced to `"dag"` in
 * {@link parseWorkflow}), never toggled per scope.
 */
export interface DagContainerNode extends DarNode {
  kind: "dagContainer";
  body: DarWorkflow;
}

/** Validates and returns a `.dar` object, throwing a clear error otherwise. */
export function parseWorkflow(raw: unknown): DarWorkflow {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Not a .dar workflow: expected a JSON object.");
  }
  // Upgrade older `darVersion`s to the current schema before reading.
  const obj = migrateDar(raw);
  if (!Array.isArray(obj.nodes)) {
    throw new Error("Not a .dar workflow: missing a `nodes` array.");
  }
  if (obj.edges !== undefined && !Array.isArray(obj.edges)) {
    throw new Error("Invalid .dar workflow: `edges` must be an array.");
  }
  return {
    // Spread FIRST so unknown top-level fields survive, then override the validated
    // ones. A fixed allowlist dropped layoutDirection, comment, and anything a newer
    // Studio adds — and the construct re-serializes this object into the deployment
    // package, so reopening a construct-deployed workflow lost canvas layout. Same
    // forward-compatibility rule the Studio's own serializer follows.
    ...obj,
    darVersion:
      typeof obj.darVersion === "string" ? obj.darVersion : DAR_VERSION,
    name: typeof obj.name === "string" ? obj.name : "workflow",
    dependencyMode: obj.dependencyMode === "dag" ? "dag" : "linear",
    ...(typeof obj.inputType === "string" ? { inputType: obj.inputType } : {}),
    ...(obj.dagConfig !== undefined && typeof obj.dagConfig === "object"
      ? { dagConfig: obj.dagConfig as DagConfigSpec }
      : {}),
    nodes: (obj.nodes as DarNode[]).map(parseNodeBodies),
    edges: (obj.edges as DarEdge[]) ?? [],
  };
}

/**
 * Recursively parses container bodies so nested workflows pass through
 * {@link migrateDar} too — each body carries its own `darVersion`, and the
 * Studio parser migrates them the same way. Without this, the first real
 * migration would silently skip everything inside a container in the deploy
 * path.
 *
 * It also NORMALIZES each container body's `dependencyMode` from structure (the
 * corrected DAG model, design §4.4): a `dagContainer` body is always `"dag"`;
 * a `group`/`map`/`parallel` body is always `"linear"`. Only the root workflow
 * keeps the `dependencyMode` it was parsed with (its Linear↔DAG toggle).
 */
function parseNodeBodies(node: DarNode): DarNode {
  if (node.kind === "dagContainer" && node.body !== undefined) {
    return {
      ...node,
      body: { ...parseWorkflow(node.body), dependencyMode: "dag" },
    };
  }
  if (
    (node.kind === "map" || node.kind === "group") &&
    node.body !== undefined
  ) {
    return {
      ...node,
      body: { ...parseWorkflow(node.body), dependencyMode: "linear" },
    };
  }
  if (node.kind === "parallel" && Array.isArray(node.branches)) {
    return {
      ...node,
      branches: (node.branches as Record<string, unknown>[]).map((b) =>
        typeof b === "object" && b !== null && b.body !== undefined
          ? {
              ...b,
              body: { ...parseWorkflow(b.body), dependencyMode: "linear" },
            }
          : b,
      ),
    };
  }
  return node;
}

/** Reads and parses a `.dar` file from disk. */
export function loadWorkflow(path: string): DarWorkflow {
  return parseWorkflow(JSON.parse(readFileSync(path, "utf-8")));
}
