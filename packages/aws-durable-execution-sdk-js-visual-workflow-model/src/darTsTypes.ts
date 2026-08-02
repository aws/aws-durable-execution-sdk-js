/**
 * Types for the `.dar.ts` authoring format (see docs/dar-ts-specification.md):
 * a single TypeScript file whose graph is a typed object literal, whose code
 * blocks are named functions referenced from the literal, and whose canvas
 * layout lives in a separate trailing object. These types exist so a
 * `.dar.ts` file type-checks in any editor; the authoritative loader is the
 * static parser (the file is never executed).
 */
import type { DarEdge, DarNodeKind, DependencyMode } from "./kinds";
import type { DagConfigSpec, TriggerRule } from "./dag";

/** A code block: a function reference (canonical) or an inline string. */
export type CodeBlock = ((...args: never[]) => unknown) | string;

/** One node of a `.dar.ts` definition — like `DarNode` but code fields may be
 * function references, `body` is a reference to another definition, and there
 * is no `position` (layout is separate). Kind-specific fields are open.
 *
 * A `dagContainer` node is a body-bearing container (like `group`/`map`) whose
 * inner `body` scope is **always** `dependencyMode: "dag"` — it is the only way
 * to nest a DAG scope (`group`/`map`/`parallel` bodies are always `"linear"`).
 * Its `body.dependencyMode` is derived from structure, not toggled per scope.
 */
export interface DefinitionNode {
  id: string;
  kind: DarNodeKind;
  name: string;
  code?: CodeBlock;
  submitterCode?: CodeBlock;
  body?: WorkflowDefinition;
  branches?: { id: string; name: string; body: WorkflowDefinition }[];
  /**
   * In `dag` dependency mode, the trigger rule governing when this task runs
   * relative to its dependencies (default `"ALL_SUCCESS"`). Ignored in
   * `linear` mode. See {@link TriggerRule}.
   */
  triggerRule?: TriggerRule;
  /**
   * In `dag` dependency mode, a TypeScript predicate body over `deps`, emitted
   * as `{ runIf: (deps) => <expr> }` — the task is skipped when it returns
   * false. Ignored in `linear` mode.
   */
  runIf?: string;
  [key: string]: unknown;
}

/** The semantic workflow: exactly what the code generator consumes. */
export interface WorkflowDefinition {
  darVersion?: string;
  name: string;
  dependencyMode?: DependencyMode;
  /** TypeScript type of the execution input (`event`). Root only. */
  inputType?: string;
  /**
   * Workflow-level DAG configuration (max concurrency, completion policy,
   * default trigger rule, nesting). Only meaningful when `dependencyMode` is
   * `"dag"`; ignored otherwise. See {@link DagConfigSpec}.
   */
  dagConfig?: DagConfigSpec;
  nodes: DefinitionNode[];
  edges: DarEdge[];
}

/** Presentation only — advisory, self-healing (missing ⇒ auto-layout). */
export interface WorkflowLayout {
  direction?: "TB" | "LR";
  /** Node id → [x, y]. Ids are unique across the whole file. */
  positions: Record<string, [number, number]>;
}
