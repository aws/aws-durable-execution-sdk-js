/**
 * Data model for the Workflow Studio drag-and-drop builder and the `.dar` file
 * format it reads/writes. A `.dar` file is JSON of {@link DarWorkflow}.
 *
 * The node kinds mirror the core durable-execution primitives plus a few
 * Studio-level conveniences (see the shared `DAR_NODE_KINDS`):
 *   - step             — run a TypeScript code block as a durable step
 *   - inline           — plain non-checkpointed TypeScript between durable ops
 *   - wait             — suspend for a fixed duration
 *   - callback         — wait for an external callback (waitForCallback)
 *   - chainInvoke      — durably invoke another function (context.invoke)
 *   - waitForCondition — poll until a TypeScript condition block is satisfied
 *   - condition        — evaluate a TypeScript expression and branch to a
 *                        different node based on the matched result
 *   - map / group / parallel — container kinds holding child workflows
 *   - awsJob           — start an AWS job + poll it (step + waitForCondition)
 *   - awsSdkCall       — a single AWS SDK v3 call wrapped in a durable step
 *   - start / end      — structural markers (not durable operations)
 *
 * Code-bearing kinds carry a TypeScript `code` block; the others use typed
 * scalar fields.
 */

import {
  defaultStepRetry,
  defaultWaitStrategy,
  normalizeStrategy,
} from "./strategy";
import type { RetryStrategySpec } from "./strategy";
import {
  DAR_NODE_KINDS,
  DAR_VERSION,
  errorEdgesFor,
  flowEdges,
  migrateDar,
  RESERVED_IDENTIFIERS,
  toIdentifier,
  inferDependencyKind,
  TRIGGER_RULES,
  SERVICE_INTEGRATION_LIST,
  type DarEdge,
  type DarEdgeKind,
  type DarEdgeDependencyKind,
  type DarNodeKind,
  type DarPosition,
  type DependencyMode,
  type ErrorBranch,
  type TriggerRule,
  type DagNestingKind,
  type DagConfigSpec,
  type DagCompletionConfigSpec,
  type DagThresholdCompletionConfigSpec,
  type DagCustomCompletionConfigSpec,
  type InferDependencyKindParams,
} from "@aws/durable-execution-sdk-js-visual-workflow-model";

// Structural primitives now live in the shared visual-workflow-model package
// (single source of truth with the CDK generator); re-exported so existing
// `./studioModel/model` and `./studioTypes` imports keep working.
export {
  DAR_VERSION,
  RESERVED_IDENTIFIERS,
  toIdentifier,
  inferDependencyKind,
  flowEdges,
  errorEdgesFor,
  TRIGGER_RULES,
};
export type {
  DarEdge,
  DarEdgeKind,
  DarEdgeDependencyKind,
  DarNodeKind,
  DarPosition,
  DependencyMode,
  ErrorBranch,
  TriggerRule,
  DagNestingKind,
  DagConfigSpec,
  DagCompletionConfigSpec,
  DagThresholdCompletionConfigSpec,
  DagCustomCompletionConfigSpec,
  InferDependencyKindParams,
};

export type DurationUnit = "seconds" | "minutes" | "hours" | "days";

/** Canvas auto-layout / edge-routing direction. */
export type LayoutDirection = "TB" | "LR";

/** Map iteration nesting, mirroring the SDK's NestingType enum. */
export type NestingKind = "NESTED" | "FLAT";

interface DarNodeCommon {
  /** Stable id, unique within the workflow (also used to key edges). */
  id: string;
  kind: DarNodeKind;
  /** Human/operation name (becomes the durable operation name on export). */
  name: string;
  position: DarPosition;
  /**
   * When true (only meaningful on non-terminal kinds), the workflow ends after
   * this node — the Studio shows an owned `end` node linked from it.
   */
  terminal?: boolean;
  /** Optional human comment/description (ASL `Comment` equivalent). */
  comment?: string;
  /**
   * Error **fallbacks**: on failure (retries exhausted / timeout / invoke
   * error), each entry is matched by error type (blank = catch-all) and
   * supplies a fallback value. Error **routes** are `"error"`-kind edges, not
   * branches. Empty/absent (and no error edges) = fail (propagate).
   * Meaningful for step/inline/callback/chainInvoke/waitForCondition/map/
   * group/parallel/awsJob.
   */
  onError?: ErrorBranch[];
  /**
   * Optional TypeScript type of this node's result (the value bound to its
   * result const). Emitted as a `const <name>: <resultType> = …` annotation and
   * surfaced in the "Edit in VS Code" scaffold so downstream code type-checks
   * against it. Absent => inferred/`any`. Meaningful for result-binding kinds.
   */
  resultType?: string;
  /**
   * True when `resultType` was produced by inference (not hand-authored). The
   * inspector marks manual edits as author-owned (false) so re-inference never
   * clobbers a type the user typed themselves.
   */
  resultTypeInferred?: boolean;
  /**
   * DAG mode only: the trigger rule governing when this task runs relative to
   * its dependencies (default `"ALL_SUCCESS"` when absent). Ignored in linear
   * mode. See {@link TriggerRule}. Meaningful for operation kinds.
   */
  triggerRule?: TriggerRule;
  /**
   * DAG mode only: a TypeScript predicate body over `deps`, emitted as
   * `{ runIf: (deps) => <expr> }` — the task is skipped when it returns false.
   * Ignored in linear mode. Meaningful for operation kinds.
   */
  runIf?: string;
}

export interface StepNode extends DarNodeCommon {
  kind: "step";
  /** TypeScript body executed inside `context.step(name, async () => { ... })`. */
  code: string;
  /** Retry strategy applied to the step (createRetryStrategy / linear / none). */
  retry: RetryStrategySpec;
}

/**
 * Plain, non-checkpointed TypeScript run inline between durable operations (no
 * `context.step`). It runs on every replay, so it must be deterministic and
 * side-effect-free — use a `step` for anything non-deterministic or I/O. There
 * is no retry (nothing is checkpointed), but it supports error branches
 * (compiled to a try/catch). Its returned value binds to a const for
 * downstream nodes.
 */
export interface InlineNode extends DarNodeCommon {
  kind: "inline";
  /** TypeScript body executed inline; its returned value binds to a const. */
  code: string;
}

/** Terminal marker: where the workflow begins. */
export interface StartNode extends DarNodeCommon {
  kind: "start";
}

/** How a workflow terminates at an `end` node. */
export type EndMode = "return" | "throw";

/**
 * Terminal marker: where the workflow ends. Optionally returns data or throws
 * an error. `code` is a TypeScript block (it may reference upstream result
 * consts); when blank, "return" returns the last result and "throw" throws a
 * default Error.
 */
export interface EndNode extends DarNodeCommon {
  kind: "end";
  /** Whether the workflow returns data or throws here. @default "return" */
  endMode?: EndMode;
  /** Optional TypeScript block: `return <expr>;` or `throw new Error(...);`. */
  code?: string;
}

export interface WaitNode extends DarNodeCommon {
  kind: "wait";
  durationValue: number;
  durationUnit: DurationUnit;
  /**
   * Optional TypeScript block returning the wait duration in SECONDS —
   * computed from upstream results (must be deterministic). When present it
   * overrides `durationValue`/`durationUnit` (which remain as a fallback).
   */
  durationCode?: string;
}

export interface CallbackNode extends DarNodeCommon {
  kind: "callback";
  timeoutValue: number;
  timeoutUnit: DurationUnit;
  /** Optional TypeScript body for the submitter (receives `callbackId`). */
  submitterCode: string;
}

export interface ChainInvokeNode extends DarNodeCommon {
  kind: "chainInvoke";
  /** Qualified function ARN or name (version/alias required). */
  functionArn: string;
  /** JSON payload text passed to the invoked function. */
  payload: string;
}

export interface WaitForConditionNode extends DarNodeCommon {
  kind: "waitForCondition";
  /** TypeScript body returning the next state; polled until stopped. */
  code: string;
  /** JSON text for the initial polling state. */
  initialState: string;
  /**
   * TypeScript boolean expression over `state` (the latest polling state);
   * polling stops when it evaluates truthy. Replaces the old `{ done: true }`
   * convention.
   */
  stopCondition: string;
  /** Polling strategy (createWaitStrategy / linear / none). */
  wait: RetryStrategySpec;
}

/**
 * Branch/switch node: evaluates a TypeScript expression (`code`) and routes to
 * a different node depending on the result. Each branch is an outgoing edge
 * whose {@link DarEdge.match} holds the value to match against; the edge with
 * no match (if any) acts as the default/else branch.
 */
export interface ConditionNode extends DarNodeCommon {
  kind: "condition";
  /** TypeScript expression whose result is matched against branch labels. */
  code: string;
}

/**
 * Map/fan-out node: iterates over an array and runs a child workflow ({@link
 * MapNode.body}) for each element, mirroring `context.map(name, items,
 * iteratee, config)`. The child workflow is edited by drilling into it.
 */
export interface MapNode extends DarNodeCommon {
  kind: "map";
  /** TypeScript expression returning the array to iterate over. */
  itemsCode: string;
  /** Max iterations run concurrently. */
  maxConcurrency: number;
  /** completionConfig.minSuccessful (optional). */
  minSuccessful?: number;
  /** completionConfig.toleratedFailureCount (optional). */
  toleratedFailureCount?: number;
  /** completionConfig.toleratedFailurePercentage, 0-100 (optional). */
  toleratedFailurePercentage?: number;
  /**
   * Iteration nesting (SDK NestingType). NESTED = full child contexts with
   * checkpointing (default); FLAT = virtual contexts, cheaper (~30%), no
   * per-iteration checkpoint. Undefined = NESTED.
   */
  nesting?: NestingKind;
  /** The per-iteration child workflow. The current element is bound as `item`. */
  body: DarWorkflow;
}

/**
 * Group node: runs a named child workflow under a child context, mirroring
 * `context.runInChildContext(name, async (childCtx) => { … })`. Edited by
 * drilling into the body; it has no config of its own.
 */
export interface GroupNode extends DarNodeCommon {
  kind: "group";
  /** The grouped child workflow. */
  body: DarWorkflow;
}

/**
 * DAG-container node: a body-bearing container (like {@link GroupNode}) whose
 * inner `body` scope is **always** `dependencyMode: "dag"` — the ONLY way to
 * nest a DAG scope in the corrected model (`group`/`map`/`parallel` bodies are
 * always `"linear"`; there is no per-scope mode toggle inside them). Drill into
 * the body to author its DAG tasks. On export it emits `context.dag(...)` in a
 * linear parent scope, or `dag.dag(name, deps, …)` when its parent scope is
 * itself DAG. Its `body.dependencyMode` is derived from this structure, not
 * toggled per scope.
 */
export interface DagContainerNode extends DarNodeCommon {
  kind: "dagContainer";
  /** The nested child workflow — always in DAG (`dependencyMode: "dag"`) mode. */
  body: DarWorkflow;
  /**
   * Container-level DAG configuration (max concurrency, completion policy,
   * default trigger rule, nesting). Codegen reads `node.dagConfig` in
   * preference to `body.dagConfig`. See {@link DagConfigSpec}.
   */
  dagConfig?: DagConfigSpec;
}

/** One branch of a parallel node — a named child workflow. */
export interface ParallelBranch {
  id: string;
  name: string;
  body: DarWorkflow;
}

/**
 * Parallel node: runs multiple named branches concurrently, each its own child
 * workflow — mirroring `context.parallel(name, branches, config)`. Drill into a
 * branch from the inspector.
 */
export interface ParallelNode extends DarNodeCommon {
  kind: "parallel";
  branches: ParallelBranch[];
  maxConcurrency?: number;
  minSuccessful?: number;
  toleratedFailureCount?: number;
  toleratedFailurePercentage?: number;
}

/**
 * AWS "Run a Job" service integration node (the Step Functions `.sync`
 * pattern): starts an asynchronous AWS job and polls until it reaches a
 * terminal status. Behind the scenes the generator expands it into a `step`
 * (start) + `waitForCondition` (poll). Which service it runs is chosen by
 * `integration` (a key into the shared SERVICE_INTEGRATIONS registry).
 */
export interface AwsJobNode extends DarNodeCommon {
  kind: "awsJob";
  /** Registry key of the service integration (e.g. "glue.startJobRun"). */
  integration: string;
  /** JSON or JS expression for the start command input. */
  startInput: string;
  /** Seconds between status polls (preset default when unset). */
  pollIntervalSeconds?: number;
  /** Optional AWS region override for the SDK client. */
  region?: string;
}

/**
 * A single AWS SDK v3 call wrapped in a durable step. The service client +
 * operation are chosen in the Studio via on-demand runtime reflection; the CDK
 * generator emits `new <clientClass>({}).send(new <command>(input))`.
 */
export interface AwsSdkCallNode extends DarNodeCommon {
  kind: "awsSdkCall";
  /** The service client package, e.g. "@aws-sdk/client-dynamodb". */
  clientPackage: string;
  /** The client class, e.g. "DynamoDBClient". */
  clientClass: string;
  /** Full command class name, e.g. "PutItemCommand". */
  command: string;
  /** JSON (or JS expression) for the command input. */
  input: string;
  /** Optional AWS region override for the SDK client. */
  region?: string;
  /** Retry strategy applied to the wrapping step. */
  retry?: RetryStrategySpec;
}

/** HTTP verbs a {@link HttpCallNode} may use. */
export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * How a {@link HttpCallNode} presents its credential. In every case the SECRET
 * ITSELF comes from a Lambda environment variable — the model only ever stores
 * the variable's NAME. A `.dar.ts` is committed to git and embedded verbatim in
 * the deployment zip, so a literal key here would leak into both.
 */
export const HTTP_AUTH_KINDS = [
  "none",
  "bearer",
  "header",
  "basic",
  "query",
] as const;
export type HttpAuthKind = (typeof HTTP_AUTH_KINDS)[number];

/**
 * A single third-party HTTP (REST) request wrapped in a durable step — the
 * non-AWS counterpart to {@link AwsSdkCallNode}. The vendor + operation are
 * chosen in the Studio by browsing that vendor's own published OpenAPI spec,
 * which prefills url/method/headers/body; every field stays hand-editable.
 *
 * The CDK generator emits a single `fetch` using the Node runtime's global —
 * no dependency to bundle. See `generateHandler.ts`'s `httpCallLines`.
 */
export interface HttpCallNode extends DarNodeCommon {
  kind: "httpCall";
  /** HTTP verb. */
  method: HttpMethod;
  /**
   * Full request URL. May contain `${…}` template expressions referencing
   * upstream node results (emitted as a template literal).
   */
  url: string;
  /** JSON object (or JS expression) of extra request headers. */
  headers?: string;
  /** JSON object (or JS expression) of query-string parameters. */
  query?: string;
  /** JSON (or JS expression) request body. Ignored for GET/HEAD. */
  body?: string;
  /** How the credential is presented; defaults to "none". */
  authKind?: HttpAuthKind;
  /**
   * NAME of the Lambda environment variable holding the credential (e.g.
   * "STRIPE_API_KEY") — never the credential itself.
   */
  authEnvVar?: string;
  /** Header or query-param name for the "header"/"query" auth kinds. */
  authName?: string;
  /** Abort the request after this many seconds (omitted/0 = no timeout). */
  timeoutSeconds?: number;
  /** Provenance: catalog spec this node was filled from (e.g. "stripe"). */
  specId?: string;
  /** Provenance: OpenAPI `operationId`, so the browser can re-open it. */
  operationId?: string;
  /** Retry strategy applied to the wrapping step. */
  retry?: RetryStrategySpec;
}

export type DarNode =
  | StartNode
  | StepNode
  | InlineNode
  | WaitNode
  | CallbackNode
  | ChainInvokeNode
  | WaitForConditionNode
  | ConditionNode
  | MapNode
  | GroupNode
  | DagContainerNode
  | ParallelNode
  | AwsJobNode
  | AwsSdkCallNode
  | HttpCallNode
  | EndNode;

export interface DarWorkflow {
  darVersion: string;
  name: string;
  /** Optional human comment/description (ASL `Comment` equivalent). */
  comment?: string;
  /** Fan-out policy for this workflow's graph (default "linear" when absent). */
  dependencyMode?: DependencyMode;
  /**
   * Workflow-level DAG configuration (max concurrency, completion policy,
   * default trigger rule, nesting). Only meaningful when `dependencyMode` is
   * `"dag"`; ignored otherwise. See {@link DagConfigSpec}.
   */
  dagConfig?: DagConfigSpec;
  /**
   * TypeScript type of the execution input (`event`). Root workflow only;
   * absent => `unknown`. Child workflows don't receive the execution input.
   */
  inputType?: string;
  /**
   * Canvas layout direction: "TB" (top-to-bottom, default) or "LR"
   * (left-to-right). Root workflow only; drives auto-layout + edge routing.
   */
  layoutDirection?: LayoutDirection;
  /**
   * Deployment record from the file's trailing `meta.deploy` block (host
   * fills it on load; the extension stamps it on every deploy). Root
   * workflow only. Lets Debug/Deploy target the right Lambda after a
   * fresh reopen — see JsonWorkflow.deploy in the host's darTs.ts.
   */
  deploy?: { functionName: string; region: string; deployedAt?: string };
  nodes: DarNode[];
  edges: DarEdge[];
}

/** True for node kinds whose primary content is a TypeScript code block. */
export function hasCodeBlock(
  kind: DarNodeKind,
): kind is "step" | "waitForCondition" {
  return kind === "step" || kind === "waitForCondition";
}

export const NODE_KIND_LABELS: Record<DarNodeKind, string> = {
  start: "Start",
  step: "Step",
  inline: "Inline",
  wait: "Wait",
  callback: "Callback",
  chainInvoke: "Chain invoke",
  waitForCondition: "Wait for condition",
  condition: "Condition",
  map: "Map",
  group: "Group",
  dagContainer: "DAG Container",
  parallel: "Parallel",
  awsJob: "AWS job",
  awsSdkCall: "AWS SDK call",
  httpCall: "API call",
  end: "End",
};

/** True for node kinds that contain a child workflow (drillable containers). */
export function isContainerKind(kind: DarNodeKind): boolean {
  return kind === "map" || kind === "group" || kind === "dagContainer";
}

/** Effective fan-out policy for a workflow (defaults to "linear" when unset). */
export function isLinearWorkflow(wf: DarWorkflow): boolean {
  return (wf.dependencyMode ?? "linear") === "linear";
}

/** True when a workflow's scope is in DAG (multiple-dependency) mode. */
export function isDagWorkflow(wf: DarWorkflow): boolean {
  return (wf.dependencyMode ?? "linear") === "dag";
}

/**
 * Returns `wf` with its {@link DependencyMode} set to `mode`, **without
 * touching its edges**. The linear↔dag toggle deliberately keeps existing
 * connections: switching dag→linear surfaces any fan-in/fan-out that violates
 * the 1:1 rule through validation (see {@link validateWorkflow}) rather than
 * silently deleting edges. Returns `wf` unchanged when already in `mode`.
 */
export function setWorkflowDependencyMode(
  wf: DarWorkflow,
  mode: DependencyMode,
): DarWorkflow {
  if ((wf.dependencyMode ?? "linear") === mode) return wf;
  return { ...wf, dependencyMode: mode };
}

/**
 * Result-const identifiers of every operation node upstream of `nodeId` (all
 * ancestors reachable backwards through edges) — the results already bound
 * before this node runs, which its code may reference. Sorted for stability.
 */
export function upstreamResultNames(
  nodes: DarNode[],
  edges: DarEdge[],
  nodeId: string,
): string[] {
  const preds = new Map<string, string[]>();
  const addPred = (target: string, source: string) => {
    const list = preds.get(target);
    if (list) list.push(source);
    else preds.set(target, [source]);
  };
  // All routing is edges — including `"error"` edges, whose target runs inside
  // the failing node's `catch`, so the failing node's ancestors' result consts
  // are in scope there too (the predecessor walk covers it naturally).
  for (const e of edges) addPred(e.target, e.source);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const stack = [...(preds.get(nodeId) ?? [])];
  const names = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (n && n.kind !== "start" && n.kind !== "end") {
      names.add(toIdentifier(n.name));
    }
    for (const p of preds.get(id) ?? []) stack.push(p);
  }
  return [...names].sort();
}

/**
 * True for kinds that become a named durable operation on export. `start`/`end`
 * are structural markers (many `end` nodes all share the name "end"), so name
 * uniqueness is enforced only among these operation kinds.
 */
export function isOperationKind(kind: DarNodeKind): boolean {
  return kind !== "start" && kind !== "end";
}

/** Returns `base` if it isn't in `taken`, otherwise `base-2`, `base-3`, … */
export function makeUniqueName(base: string, taken: Set<string>): string {
  const b = base.trim() || "node";
  if (!taken.has(b)) return b;
  let i = 2;
  while (taken.has(`${b}-${i}`)) i += 1;
  return `${b}-${i}`;
}

/**
 * Returns `${base}${n}` for the smallest n ≥ 1 not already in `taken`
 * (e.g. step1, step2, step3). Used to name newly added nodes so every node
 * carries a numeric suffix consistently.
 */
export function nextIndexedName(base: string, taken: Set<string>): string {
  const b = base.trim() || "node";
  let i = 1;
  while (taken.has(`${b}${i}`)) i += 1;
  return `${b}${i}`;
}

/** Set of operation-node names, optionally excluding one node id (the one being
 *  renamed), used to keep names unique. */
export function operationNames(
  wf: DarWorkflow,
  excludeId?: string,
): Set<string> {
  return new Set(
    wf.nodes
      .filter((n) => isOperationKind(n.kind) && n.id !== excludeId)
      .map((n) => n.name.trim())
      .filter((n) => n.length > 0),
  );
}

let idCounter = 0;
/** Generates a workflow-unique id. Time + counter keeps ids stable per session
 *  and readable in the saved file. */
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

/** Builds a new node of the given kind with sensible defaults. */
export function createNode(
  kind: DarNodeKind,
  position: DarPosition,
  integration?: string,
): DarNode {
  const id = newId("n");
  switch (kind) {
    case "start":
      return { id, kind, name: "start", position };
    case "end":
      return { id, kind, name: "end", position };
    case "step":
      return {
        id,
        kind,
        name: "step",
        position,
        code: "// return a value from this step\nreturn {};",
        retry: defaultStepRetry(),
      };
    case "inline":
      return {
        id,
        kind,
        name: "inline",
        position,
        code: "// deterministic code between durable ops (no checkpoint)\nreturn {};",
      };
    case "wait":
      return {
        id,
        kind,
        name: "wait",
        position,
        durationValue: 30,
        durationUnit: "seconds",
      };
    case "callback":
      return {
        id,
        kind,
        name: "wait-for-callback",
        position,
        timeoutValue: 24,
        timeoutUnit: "hours",
        submitterCode:
          "// send `callbackId` to the external system\n// await notify(callbackId);",
      };
    case "chainInvoke":
      return {
        id,
        kind,
        name: "invoke",
        position,
        functionArn:
          "arn:aws:lambda:us-east-1:123456789012:function:target:$LATEST",
        payload: "{}",
      };
    case "waitForCondition":
      return {
        id,
        kind,
        name: "wait-for-condition",
        position,
        code: "// return the next polling state\nreturn { ...state, done: true };",
        initialState: "{ }",
        stopCondition: "state.done === true",
        wait: defaultWaitStrategy(),
      };
    case "condition":
      return {
        id,
        kind,
        name: "condition",
        position,
        code: '// return a value to branch on (compared against each branch\'s match)\nreturn "DEFAULT";',
      };
    case "map":
      return {
        id,
        kind,
        name: "map",
        position,
        itemsCode: "// return the array to iterate over\nreturn input.items;",
        maxConcurrency: 5,
        body: starterWorkflow(),
      };
    case "group":
      return {
        id,
        kind,
        name: "group",
        position,
        body: starterWorkflow(),
      };
    case "dagContainer":
      return {
        id,
        kind,
        name: "dag",
        position,
        // A dagContainer's body is ALWAYS a DAG scope (no per-scope toggle).
        body: starterDagWorkflow(),
      };
    case "parallel":
      return {
        id,
        kind,
        name: "parallel",
        position,
        branches: [
          { id: newId("b"), name: "branch-1", body: starterWorkflow() },
          { id: newId("b"), name: "branch-2", body: starterWorkflow() },
        ],
        maxConcurrency: 5,
      };
    case "awsJob": {
      const preset =
        SERVICE_INTEGRATION_LIST.find((p) => p.key === integration) ??
        SERVICE_INTEGRATION_LIST[0];
      return {
        id,
        kind,
        name: preset ? preset.service : "job",
        position,
        integration: preset ? preset.key : (integration ?? ""),
        startInput: "{ }",
      };
    }
    case "awsSdkCall":
      return {
        id,
        kind,
        name: "sdk-call",
        position,
        clientPackage: "",
        clientClass: "",
        command: "",
        input: "{}",
      };
    case "httpCall":
      return {
        id,
        kind,
        name: "api-call",
        position,
        method: "GET",
        url: "",
        authKind: "none",
      };
  }
}

/**
 * Validates and normalizes an arbitrary parsed object into a DarWorkflow.
 * Throws a descriptive Error if the shape is not a recognizable `.dar` file, so
 * the UI can surface a clear message instead of rendering garbage.
 */
export function parseWorkflow(raw: unknown): DarWorkflow {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Not a .dar workflow: expected a JSON object.");
  }
  // Upgrade older `darVersion`s to the current schema before reading.
  const obj = migrateDar(raw);
  if (!Array.isArray(obj.nodes)) {
    throw new Error("Not a .dar workflow: missing a `nodes` array.");
  }
  const nodes: DarNode[] = obj.nodes.map((n, i) => {
    const node = (n ?? {}) as Record<string, unknown>;
    const kind = node.kind as DarNodeKind;
    // Validate against the shared runtime kind list (single source of truth
    // with the CDK generator) — a new kind only needs registering once there.
    if (!DAR_NODE_KINDS.includes(kind)) {
      throw new Error(`Node ${i} has an unknown kind: ${String(node.kind)}`);
    }
    const pos = (node.position ?? {}) as Record<string, unknown>;
    const base = createNode(kind, {
      x: typeof pos.x === "number" ? pos.x : 40 + i * 40,
      y: typeof pos.y === "number" ? pos.y : 40 + i * 40,
    });
    // Preserve the saved id/name, then overlay any kind-specific fields present.
    const merged = {
      ...base,
      ...node,
      id: typeof node.id === "string" ? node.id : base.id,
      name: typeof node.name === "string" ? node.name : base.name,
      kind,
      position: base.position,
    } as DarNode;
    // Strategy sub-objects may be missing/partial in older or hand-edited files
    // — merge them over the kind's defaults so the UI always has valid values.
    if (merged.kind === "step") {
      merged.retry = normalizeStrategy(node.retry, defaultStepRetry());
    } else if (merged.kind === "waitForCondition") {
      merged.wait = normalizeStrategy(node.wait, defaultWaitStrategy());
    } else if (merged.kind === "map" || merged.kind === "group") {
      // The per-iteration / grouped body is itself a workflow — parse it.
      // group/map bodies are always LINEAR in the corrected model.
      merged.body =
        node.body === undefined
          ? starterWorkflow()
          : { ...parseWorkflow(node.body), dependencyMode: "linear" };
    } else if (merged.kind === "dagContainer") {
      // A dagContainer's body is always a DAG scope (derived from structure).
      merged.body =
        node.body === undefined
          ? starterDagWorkflow()
          : { ...parseWorkflow(node.body), dependencyMode: "dag" };
    } else if (merged.kind === "parallel") {
      // Each branch body is its own workflow — parse them recursively.
      const raw = Array.isArray(node.branches) ? node.branches : null;
      if (raw) {
        merged.branches = raw.map((b, bi) => {
          const br = (b ?? {}) as Record<string, unknown>;
          return {
            id: typeof br.id === "string" ? br.id : newId("b"),
            name: typeof br.name === "string" ? br.name : `branch-${bi + 1}`,
            body:
              br.body === undefined
                ? starterWorkflow()
                : parseWorkflow(br.body),
          };
        });
      }
    }
    // Normalize error fallbacks (drop malformed entries; ensure ids). Error
    // routes are `"error"`-kind edges, parsed with the rest of the edges.
    if (Array.isArray(node.onError)) {
      merged.onError = (node.onError as unknown[])
        .filter(
          (b): b is Record<string, unknown> =>
            typeof b === "object" && b !== null,
        )
        .map((b) => {
          const branch: ErrorBranch = {
            id: typeof b.id === "string" ? b.id : newId("eb"),
          };
          if (typeof b.errorType === "string") branch.errorType = b.errorType;
          if (typeof b.fallbackCode === "string")
            branch.fallbackCode = b.fallbackCode;
          return branch;
        });
    } else {
      delete (merged as { onError?: unknown }).onError;
    }
    return merged;
  });
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edgesRaw = Array.isArray(obj.edges) ? obj.edges : [];
  const edges: DarEdge[] = edgesRaw
    .map((e) => (e ?? {}) as Record<string, unknown>)
    .filter(
      (e) =>
        typeof e.source === "string" &&
        typeof e.target === "string" &&
        nodeIds.has(e.source) &&
        nodeIds.has(e.target),
    )
    .map((e) => ({
      id: typeof e.id === "string" ? e.id : newId("e"),
      source: e.source as string,
      target: e.target as string,
      ...(e.kind === "error" ? { kind: "error" as const } : {}),
      ...(e.dependencyKind === "ordering"
        ? { dependencyKind: "ordering" as const }
        : {}),
      ...(typeof e.match === "string" ? { match: e.match } : {}),
      ...(typeof e.errorType === "string" ? { errorType: e.errorType } : {}),
      ...(typeof e.label === "string" ? { label: e.label } : {}),
    }));
  return {
    darVersion:
      typeof obj.darVersion === "string" ? obj.darVersion : DAR_VERSION,
    name: typeof obj.name === "string" ? obj.name : "Untitled workflow",
    ...(typeof obj.comment === "string" ? { comment: obj.comment } : {}),
    dependencyMode: obj.dependencyMode === "dag" ? "dag" : "linear",
    // Workflow-level DAG config (only meaningful in dag mode). Passed through
    // as-is when a plausible object is present — the fields are optional and
    // schema-validated by the shared model, so an over-strict re-check here
    // would drop hand-edited configs.
    ...(obj.dagConfig && typeof obj.dagConfig === "object"
      ? { dagConfig: obj.dagConfig as DagConfigSpec }
      : {}),
    ...(typeof obj.inputType === "string" ? { inputType: obj.inputType } : {}),
    ...(obj.layoutDirection === "LR" || obj.layoutDirection === "TB"
      ? { layoutDirection: obj.layoutDirection }
      : {}),
    // Deployment record from meta.deploy (see DarWorkflow.deploy) — shape
    // re-validated here since files are hand-editable.
    ...(typeof (obj.deploy as Record<string, unknown> | undefined)
      ?.functionName === "string" &&
    typeof (obj.deploy as Record<string, unknown>).region === "string"
      ? {
          deploy: {
            functionName: (obj.deploy as { functionName: string }).functionName,
            region: (obj.deploy as { region: string }).region,
            ...(typeof (obj.deploy as Record<string, unknown>).deployedAt ===
            "string"
              ? {
                  deployedAt: (obj.deploy as { deployedAt: string }).deployedAt,
                }
              : {}),
          },
        }
      : {}),
    nodes,
    edges,
  };
}

/** Deterministic id of the auto-created `end` node owned by a terminal node. */
export function endNodeIdFor(sourceId: string): string {
  return `${sourceId}__end`;
}

const END_SUFFIX = "__end";

/**
 * Enforces the "owned end" invariant: an `end` node must have an incoming edge.
 * Removes any end node that has no incoming edge (e.g. after its only link was
 * deleted) and clears the terminal flag of its former owner, so an end can
 * never be left orphaned ("silo") on the canvas.
 */
export function pruneOrphanEnds(wf: DarWorkflow): DarWorkflow {
  // All routing is edges (error routes included), so incoming edges alone
  // decide whether an end node is still owned.
  const hasIncoming = new Set(wf.edges.map((e) => e.target));
  const orphanEndIds = new Set(
    wf.nodes
      .filter((n) => n.kind === "end" && !hasIncoming.has(n.id))
      .map((n) => n.id),
  );
  if (orphanEndIds.size === 0) return wf;
  const ownerIds = new Set(
    [...orphanEndIds]
      .filter((id) => id.endsWith(END_SUFFIX))
      .map((id) => id.slice(0, -END_SUFFIX.length)),
  );
  return {
    ...wf,
    nodes: wf.nodes
      .filter((n) => !orphanEndIds.has(n.id))
      .map((n) =>
        ownerIds.has(n.id) && n.terminal ? { ...n, terminal: false } : n,
      ),
    edges: wf.edges.filter(
      (e) => !orphanEndIds.has(e.source) && !orphanEndIds.has(e.target),
    ),
  };
}

/**
 * The default starter shown on first load (also used by "Clear"): a single
 * start → step1, with step1 marked terminal so an owned `end` node follows it.
 */
export function starterWorkflow(): DarWorkflow {
  const start = createNode("start", { x: 60, y: 40 });
  const step = createNode("step", { x: 60, y: 170 });
  step.name = "step1";
  step.terminal = true;
  const endId = endNodeIdFor(step.id);
  const end: DarNode = {
    id: endId,
    kind: "end",
    name: "end",
    position: { x: 60, y: 320 },
  };
  return {
    darVersion: DAR_VERSION,
    name: "Untitled workflow",
    dependencyMode: "linear",
    nodes: [start, step, end],
    edges: [
      { id: newId("e"), source: start.id, target: step.id },
      { id: newId("e"), source: step.id, target: endId },
    ],
  };
}

/**
 * The starter shown when a DAG scope is first created (a `dagContainer`'s
 * body). Unlike {@link starterWorkflow}, a DAG scope has NO `start` node and no
 * `end` node, and never marks a node terminal — the SDK has no start, a ROOT is
 * simply a task with no dependencies (`deps: []`), and a DAG completes by
 * DRAINING (no tasks in flight) or via its completion policy, yielding an
 * aggregate DagResult. Seeds ONLY a single `step` ("step1", NOT terminal) with
 * no edges — that lone step is a root task (no incoming flow edge).
 */
export function starterDagWorkflow(): DarWorkflow {
  const step = createNode("step", { x: 60, y: 40 });
  step.name = "step1";
  return {
    darVersion: DAR_VERSION,
    name: "Untitled workflow",
    dependencyMode: "dag",
    nodes: [step],
    edges: [],
  };
}

/**
 * Resolves the sub-workflow being edited by walking `map` node bodies along
 * `path` (a list of map-node ids from the root). Stops early on a stale segment.
 */
export function workflowAtPath(root: DarWorkflow, path: string[]): DarWorkflow {
  let cur = root;
  for (const seg of path) {
    let next: DarWorkflow | undefined;
    for (const n of cur.nodes) {
      if (
        (n.kind === "map" || n.kind === "group" || n.kind === "dagContainer") &&
        n.id === seg
      ) {
        next = n.body;
        break;
      }
      if (n.kind === "parallel") {
        const b = n.branches.find((br) => br.id === seg);
        if (b) {
          next = b.body;
          break;
        }
      }
    }
    if (!next) break;
    cur = next;
  }
  return cur;
}

/**
 * Non-result symbols a node's code can reference in the scope identified by
 * `path` (the active sub-workflow's path from root):
 *   - root (`[]`) → `event` + `input` (the execution input).
 *   - inside a `map` body → `item` + `index` (the current element).
 *   - inside a `group` body or `parallel` branch → none (child workflows do not
 *     get the execution input).
 */
export function scopeExtras(root: DarWorkflow, path: string[]): string[] {
  if (path.length === 0) return ["event", "input"];
  const parent = workflowAtPath(root, path.slice(0, -1));
  const seg = path[path.length - 1];
  const node = parent.nodes.find((n) => n.id === seg);
  if (node?.kind === "map") return ["item", "index"];
  return [];
}

/**
 * Returns a new root with `updater` applied to the sub-workflow at `path`
 * (recursing through `map` bodies). `path === []` updates the root itself.
 */
export function updateWorkflowAtPath(
  root: DarWorkflow,
  path: string[],
  updater: (wf: DarWorkflow) => DarWorkflow,
): DarWorkflow {
  if (path.length === 0) return updater(root);
  const [head, ...rest] = path;
  return {
    ...root,
    nodes: root.nodes.map((n) => {
      if (
        n.id === head &&
        (n.kind === "map" || n.kind === "group" || n.kind === "dagContainer")
      ) {
        return {
          ...n,
          body: updateWorkflowAtPath(n.body, rest, updater),
        } as DarNode;
      }
      if (n.kind === "parallel" && n.branches.some((b) => b.id === head)) {
        return {
          ...n,
          branches: n.branches.map((b) =>
            b.id === head
              ? { ...b, body: updateWorkflowAtPath(b.body, rest, updater) }
              : b,
          ),
        } as DarNode;
      }
      return n;
    }),
  };
}
