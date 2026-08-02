/**
 * Deterministic Pass 1 of the Step Functions → `.dar` import: map an ASL state
 * graph to a structurally-valid `.dar` skeleton (nodes + edges + layout) with
 * compilable stub code bodies. Pure and dependency-free (no `vscode`/LLM/AWS
 * imports) so it can be unit-tested directly; the agent/validation loop lives
 * in `aslImport.ts` and builds on top of this.
 */

// ─── ASL shapes (intentionally loose — real ASL is huge and versioned) ───────

export interface AslState {
  Type?: string;
  Next?: string;
  End?: boolean;
  Comment?: string;
  Resource?: string;
  Parameters?: Record<string, unknown>;
  Arguments?: Record<string, unknown>;
  ResultSelector?: Record<string, unknown>;
  ResultPath?: string;
  OutputPath?: string;
  InputPath?: string;
  /** Not translated — reported via `notes`. See DROPPED_FIELDS. */
  TimeoutSeconds?: number;
  /** Not translated — reported via `notes`. See DROPPED_FIELDS. */
  HeartbeatSeconds?: number;
  Result?: unknown;
  Seconds?: number;
  SecondsPath?: string;
  Timestamp?: string;
  TimestampPath?: string;
  Choices?: AslChoiceRule[];
  Default?: string;
  Branches?: AslStateMachine[];
  ItemProcessor?: AslStateMachine;
  Iterator?: AslStateMachine;
  ItemsPath?: string;
  MaxConcurrency?: number;
  ToleratedFailureCount?: number;
  ToleratedFailurePercentage?: number;
  Retry?: AslRetrier[];
  Catch?: AslCatcher[];
  [key: string]: unknown;
}

export interface AslRetrier {
  ErrorEquals?: string[];
  IntervalSeconds?: number;
  MaxAttempts?: number;
  BackoffRate?: number;
  MaxDelaySeconds?: number;
  JitterStrategy?: "NONE" | "FULL" | "HALF";
  [key: string]: unknown;
}

export interface AslChoiceRule {
  Next?: string;
  [key: string]: unknown;
}

export interface AslCatcher {
  ErrorEquals?: string[];
  Next?: string;
  ResultPath?: string;
}

export interface AslStateMachine {
  StartAt?: string;
  States?: Record<string, AslState>;
  QueryLanguage?: string;
  Comment?: string;
}

// ─── Skeleton result ─────────────────────────────────────────────────────────

/** A single code body the agent must author, with its source ASL context. */
export interface NodeCodeTodo {
  nodeId: string;
  kind: string;
  field: "code" | "submitterCode" | "itemsCode";
  name: string;
  /** Natural-language + ASL-fragment description for the model. */
  description: string;
}

interface DarLikeNode {
  id: string;
  kind: string;
  name: string;
  position: { x: number; y: number };
  terminal?: boolean;
  onError?: { id: string; errorType?: string; fallbackCode?: string }[];
  [key: string]: unknown;
}
interface DarLikeEdge {
  id: string;
  source: string;
  target: string;
  kind?: "error";
  match?: string;
  errorType?: string;
}
export interface DarLikeWorkflow {
  darVersion: string;
  name: string;
  comment?: string;
  dependencyMode: "linear" | "dag";
  nodes: DarLikeNode[];
  edges: DarLikeEdge[];
}

export interface SkeletonResult {
  /** A structurally-valid `.dar` workflow object (stub bodies compile). */
  workflow: DarLikeWorkflow;
  /** Code bodies the agent should fill (Pass 2). */
  todos: NodeCodeTodo[];
  /** Best-effort notes: things we mapped loosely or couldn't fully import. */
  notes: string[];
}

// ─── Retry ───────────────────────────────────────────────────────────────────

/**
 * Translate a single ASL retrier object into a `.dar` `RetryStrategySpec`
 * (see `@aws/durable-execution-sdk-js-visual-workflow-model`'s strategy.ts —
 * duplicated here since this module stays dependency-free). ASL retriers are
 * always exponential-backoff (no linear/none kind), so `kind` is fixed.
 */
function translateRetrier(r: AslRetrier): Record<string, unknown> | undefined {
  if (typeof r !== "object" || r === null) return undefined;
  return {
    kind: "exponential",
    maxAttempts: typeof r.MaxAttempts === "number" ? r.MaxAttempts : 3,
    initialDelaySeconds:
      typeof r.IntervalSeconds === "number" ? r.IntervalSeconds : 5,
    maxDelaySeconds:
      typeof r.MaxDelaySeconds === "number" ? r.MaxDelaySeconds : 300,
    backoffRate: typeof r.BackoffRate === "number" ? r.BackoffRate : 2,
    incrementSeconds: 1,
    jitter:
      r.JitterStrategy === "NONE" || r.JitterStrategy === "HALF"
        ? r.JitterStrategy
        : "FULL",
  };
}

/**
 * Translate the common ASL reference-path forms into a TypeScript expression
 * over `input`. Handles `$` (whole input), `$.a.b`, `$.a[0].b`. Anything else
 * (JSONata calls, intrinsic functions, `$$` context, `$.States...`) is returned
 * as a TODO marker so the caller/agent can see it needs attention.
 */
export function translateJsonPath(expr: string): string {
  const t = expr.trim();
  if (t === "$") return "input";
  if (t.startsWith("$$") || t.includes("(") || t.startsWith("States.")) {
    return `/* TODO translate: ${t} */ undefined`;
  }
  const m = t.match(/^\$(\.[A-Za-z0-9_$.[\]]+)$/);
  if (m) return `input${m[1]}`;
  return `/* TODO translate: ${t} */ undefined`;
}

// ─── Deterministic skeleton ──────────────────────────────────────────────────

/** Sanitize an ASL state name into a stable node id (unique in a machine). */
function idFromName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_") || "state";
}

/** Which of our node kinds a Task maps to, from its `Resource` ARN. */
function classifyTask(resource: string | undefined): {
  kind: "step" | "chainInvoke" | "callback" | "awsJob";
  integration?: string;
} {
  const r = resource ?? "";
  if (r.includes(".waitForTaskToken")) return { kind: "callback" };
  if (r.includes("states:::lambda:invoke") || r.startsWith("arn:aws:lambda:"))
    return { kind: "chainInvoke" };
  const integ = matchIntegration(r);
  if (integ) return { kind: "awsJob", integration: integ };
  return { kind: "step" };
}

/** Best-effort map from an ASL service `Resource` to one of our awsJob keys. */
function matchIntegration(resource: string): string | undefined {
  const map: Record<string, string> = {
    "glue:startJobRun": "glue.startJobRun",
    "batch:submitJob": "batch.submitJob",
    "codebuild:startBuild": "codebuild.startBuild",
    "athena:startQueryExecution": "athena.startQueryExecution",
    "states:startExecution": "sfn.startExecution",
    "ecs:runTask": "ecs.runTask",
    "databrew:startJobRun": "databrew.startJobRun",
    "sagemaker:createTrainingJob": "sagemaker.createTrainingJob",
    "sagemaker:createTransformJob": "sagemaker.createTransformJob",
    "sagemaker:createProcessingJob": "sagemaker.createProcessingJob",
  };
  for (const [needle, key] of Object.entries(map)) {
    if (resource.includes(needle)) return key;
  }
  return undefined;
}

/** JSON fragment for the model prompt (compact, capped). */
function frag(state: AslState): string {
  const s = JSON.stringify(state);
  return s.length > 1200 ? `${s.slice(0, 1200)}…` : s;
}

/**
 * Durable `context.invoke` requires a QUALIFIED function identifier (version,
 * alias, or `$LATEST`). ASL `lambda:invoke` targets are usually unqualified, so
 * append `:$LATEST` when no qualifier is present. Handles bare names and full
 * function ARNs (which have 7 colon-segments when unqualified, 8 when
 * qualified). Non-lambda references are returned unchanged.
 */
export function qualifyFunctionRef(ref: string): string {
  const r = ref.trim();
  if (!r) return r;
  if (r.startsWith("arn:aws:lambda:")) {
    // arn:aws:lambda:region:acct:function:name[:qualifier]
    return r.split(":").length >= 8 ? r : `${r}:$LATEST`;
  }
  // Bare name or name:qualifier.
  return r.includes(":") ? r : `${r}:$LATEST`;
}

function emptyBody(): DarLikeWorkflow {
  return {
    darVersion: "1.0",
    name: "body",
    dependencyMode: "linear",
    nodes: [
      { id: "start", kind: "start", name: "Start", position: { x: 40, y: 0 } },
    ],
    edges: [],
  };
}

/** Options for {@link aslToSkeleton}. */
export interface SkeletonOptions {
  /**
   * State name → inlinable Lambda handler source. When a `lambda:invoke` Task's
   * state name is present, it is imported as an inline `step` (the agent
   * reproduces the handler) instead of a `chainInvoke`. Populated by the host
   * only when the user opts in and the function is eligible.
   */
  inlineSources?: Map<string, { handler: string; source: string }>;
}

/**
 * Deterministically convert one ASL state machine to a `.dar`-like skeleton.
 * Recurses into Parallel branches and Map processors as nested workflow bodies.
 */
export function aslToSkeleton(
  machine: AslStateMachine,
  opts: SkeletonOptions = {},
): SkeletonResult {
  const notes: string[] = [];
  const todos: NodeCodeTodo[] = [];

  const build = (m: AslStateMachine): DarLikeWorkflow => {
    const states = m.States ?? {};
    const names = Object.keys(states);
    const nodes: DarLikeNode[] = [];
    const edges: DarLikeEdge[] = [];
    let edgeSeq = 0;
    const edge = (
      source: string,
      target: string,
      extra?: Partial<Pick<DarLikeEdge, "kind" | "match" | "errorType">>,
    ) => {
      edges.push({
        id: `e${edgeSeq++}_${source}_${target}`,
        source,
        target,
        ...(extra ?? {}),
      });
    };

    const startId = "start";
    nodes.push({
      id: startId,
      kind: "start",
      name: "Start",
      position: { x: 40, y: 0 },
    });
    if (m.StartAt) edge(startId, idFromName(m.StartAt));

    names.forEach((name, i) => {
      const st = states[name];
      const id = idFromName(name);
      const position = { x: 40, y: (i + 1) * 150 };
      const base = {
        id,
        name,
        position,
        ...(typeof st.Comment === "string" && st.Comment.trim() !== ""
          ? { comment: st.Comment }
          : {}),
      };
      /**
       * Fields this importer does not translate.
       *
       * These were declared on `AslState` and then never read anywhere in the
       * build, with no note pushed — so an import could look correct on the canvas
       * and route data completely differently at runtime. `ResultPath` alone
       * changes where a task's result lands; `InputPath`/`OutputPath` filter what a
       * state sees and returns; `ResultSelector` reshapes it.
       *
       * Translating JSONPath data-flow into the durable model is not a small
       * change, and guessing would be worse than not trying. But dropping it
       * silently is the part that is indefensible, so every dropped field is now
       * reported and the user can decide.
       */
      const DROPPED_FIELDS: [keyof AslState, string][] = [
        ["InputPath", "filters the input this state sees"],
        ["OutputPath", "filters what this state passes on"],
        ["ResultPath", "controls where this state's result is stored"],
        ["ResultSelector", "reshapes this state's result"],
        ["TimeoutSeconds", "bounds how long this state may run"],
        ["HeartbeatSeconds", "requires periodic heartbeats"],
      ];
      for (const [field, effect] of DROPPED_FIELDS) {
        if (st[field] !== undefined) {
          notes.push(
            `State "${name}": ${field} was not imported (it ${effect}). ` +
              `Review the generated code — data may flow differently than in the ` +
              `state machine.`,
          );
        }
      }
      // JSONata is a different expression language entirely; feeding its
      // Arguments to the JSONPath translator produces confident nonsense.
      if (st.QueryLanguage === "JSONata") {
        notes.push(
          `State "${name}": QueryLanguage is JSONata, which this importer does ` +
            `not understand — its expressions were treated as JSONPath and are ` +
            `almost certainly wrong. Rewrite them by hand.`,
        );
      }
      // Retry/Catch are only handled inside the Task case below.
      const t = st.Type ?? "Task";
      if (t !== "Task" && (st.Retry !== undefined || st.Catch !== undefined)) {
        notes.push(
          `State "${name}": Retry/Catch on a ${t} state were not imported — ` +
            `only Task states carry them through. Its retry and error handling ` +
            `are missing from the generated workflow.`,
        );
      }

      const type = st.Type ?? "Task";
      const markTerminal = (n: DarLikeNode) => {
        if (st.End === true) n.terminal = true;
      };

      switch (type) {
        case "Task": {
          const inline = opts.inlineSources?.get(name);
          const isLambda =
            (st.Resource ?? "").includes("states:::lambda:invoke") ||
            (st.Resource ?? "").startsWith("arn:aws:lambda:");
          let node: DarLikeNode;
          if (isLambda && inline) {
            // Opt-in inline: import the Lambda handler as a durable step.
            node = { ...base, kind: "step", code: "return input;" };
            notes.push(
              `"${name}" inlined from Lambda ${inline.handler}; its IAM role / env vars / layers are NOT imported — review.`,
            );
            todos.push({
              nodeId: id,
              kind: "step",
              field: "code",
              name,
              description: `Inline this AWS Lambda handler as a durable step. Reproduce the handler's logic in a TS body that returns its result; the ASL invoke passes its Payload as the event (available as \`input\`). Handler entry: ${inline.handler}. ASL state: ${frag(st)}\n\n--- Lambda handler source (${inline.handler}) ---\n${inline.source}`,
            });
          } else {
            const { kind, integration } = classifyTask(st.Resource);
            if (kind === "chainInvoke") {
              const rawRef =
                (st.Parameters?.FunctionName as string) ?? st.Resource ?? "";
              const payloadSpec = st.Parameters?.Payload;
              // ASL often maps the payload with JSONPath (`Payload.$` or `.$`
              // keys) which we can't resolve statically — flag it for review.
              const dynamicPayload =
                "Payload.$" in (st.Parameters ?? {}) ||
                (payloadSpec != null &&
                  typeof payloadSpec === "object" &&
                  Object.keys(payloadSpec as Record<string, unknown>).some(
                    (k) => k.endsWith(".$"),
                  ));
              if (dynamicPayload)
                notes.push(
                  `"${name}" invoke payload uses JSONPath; review the payload passed to the function.`,
                );
              node = {
                ...base,
                kind,
                functionArn: qualifyFunctionRef(rawRef),
                payload: JSON.stringify(payloadSpec ?? {}, null, 2),
              };
            } else if (kind === "awsJob") {
              node = { ...base, kind, integration, params: {} };
              notes.push(
                `"${name}" mapped to an awsJob (${integration}); review its parameters.`,
              );
            } else if (kind === "callback") {
              node = { ...base, kind, submitterCode: "" };
              todos.push({
                nodeId: id,
                kind,
                field: "submitterCode",
                name,
                description: `Send \`callbackId\` to the external system for this ASL .waitForTaskToken task. ASL state: ${frag(st)}`,
              });
            } else {
              node = { ...base, kind: "step", code: "return input;" };
              todos.push({
                nodeId: id,
                kind: "step",
                field: "code",
                name,
                description: `Implement this ASL Task as a durable step. Translate its Resource/Parameters/ResultSelector into a TS body returning the result. ASL state: ${frag(st)}`,
              });
            }
          }
          if (st.Catch && st.Catch.length > 0) {
            // Each Catch clause becomes an `"error"`-kind edge (routing lives
            // on edges, never on nodes).
            for (const c of st.Catch) {
              if (!c.Next) continue;
              // `errorType` becomes `err instanceof <Type>` in generated code, so
              // it must name a REAL JavaScript error class. ASL error names are
              // not classes: "States.Timeout" emits
              // `err instanceof States.Timeout`, which is a ReferenceError at
              // runtime, and "States.ALL" is ASL's catch-all rather than a type at
              // all. (Codegen does already split a comma-separated errorType and
              // OR the checks, so the joining itself was never the problem.)
              //
              // So: States.ALL becomes a genuine catch-all (no errorType), other
              // States.* names are dropped with a note, and non-States names are
              // kept since a custom ASL error name plausibly IS the thrown class.
              const equals = (c.ErrorEquals ?? []).map((e) => e.trim());
              const isCatchAll = equals.some((e) => e === "States.ALL");
              const aslBuiltins = equals.filter(
                (e) => e.startsWith("States.") && e !== "States.ALL",
              );
              const usable = equals.filter((e) => !e.startsWith("States."));
              if (aslBuiltins.length > 0) {
                notes.push(
                  `State "${name}": catch on ${aslBuiltins.join(", ")} could not ` +
                    `be preserved — ASL error names are not JavaScript error ` +
                    `classes. This edge now catches ${
                      isCatchAll || usable.length === 0
                        ? "every error"
                        : usable.join(", ")
                    }; narrow it by hand if that is too broad.`,
                );
              }
              const errorType =
                isCatchAll || usable.length === 0
                  ? undefined
                  : usable.join(",");
              edge(id, idFromName(c.Next), {
                kind: "error",
                ...(errorType ? { errorType } : {}),
              });
            }
          }
          if (st.Retry && st.Retry.length > 0) {
            const spec = translateRetrier(st.Retry[0]);
            if (spec) node.retry = spec;
            if (st.Retry.length > 1)
              notes.push(
                `"${name}" has ${st.Retry.length} Retry policies; only the first was imported — review the rest manually.`,
              );
          }
          markTerminal(node);
          nodes.push(node);
          if (st.Next) edge(id, idFromName(st.Next));
          break;
        }
        case "Pass": {
          // A Pass state injects/transforms data with no external work — a
          // pure, deterministic transform. That's exactly our `inline` node
          // (plain TS, no checkpoint), cheaper and more faithful than a step.
          const node: DarLikeNode = {
            ...base,
            kind: "inline",
            code: "return input;",
          };
          todos.push({
            nodeId: id,
            kind: "inline",
            field: "code",
            name,
            description: `Implement this ASL Pass state (inject/transform data, no external work) as deterministic inline code. ASL state: ${frag(st)}`,
          });
          markTerminal(node);
          nodes.push(node);
          if (st.Next) edge(id, idFromName(st.Next));
          break;
        }
        case "Wait": {
          const seconds =
            typeof st.Seconds === "number" ? st.Seconds : undefined;
          const secondsPath =
            typeof st.SecondsPath === "string" ? st.SecondsPath : undefined;
          if (seconds === undefined && secondsPath === undefined)
            notes.push(
              `"${name}" is a dynamic Wait (Timestamp); defaulted to 1s — adjust as needed.`,
            );
          const node: DarLikeNode = {
            ...base,
            kind: "wait",
            durationValue: seconds ?? 1,
            durationUnit: "seconds",
            // SecondsPath → dynamic duration computed from the input.
            ...(secondsPath
              ? { durationCode: `return ${translateJsonPath(secondsPath)};` }
              : {}),
          };
          markTerminal(node);
          nodes.push(node);
          if (st.Next) edge(id, idFromName(st.Next));
          break;
        }
        case "Choice": {
          const node: DarLikeNode = {
            ...base,
            kind: "condition",
            code: "undefined",
          };
          const labels: string[] = [];
          for (const rule of st.Choices ?? []) {
            if (!rule.Next) continue;
            edge(id, idFromName(rule.Next), { match: rule.Next });
            labels.push(rule.Next);
          }
          if (st.Default) edge(id, idFromName(st.Default));
          todos.push({
            nodeId: id,
            kind: "condition",
            field: "code",
            name,
            description: `Write a single TS expression that returns ONE of these branch labels (the target state name) based on the ASL Choice rules, or undefined for the default. Labels: ${labels.join(", ")}. ASL state: ${frag(st)}`,
          });
          nodes.push(node);
          break;
        }
        case "Parallel": {
          const branches = (st.Branches ?? []).map((b, bi) => ({
            id: `${id}_b${bi}`,
            name: `Branch ${bi + 1}`,
            body: build(b),
          }));
          const node: DarLikeNode = { ...base, kind: "parallel", branches };
          markTerminal(node);
          nodes.push(node);
          if (st.Next) edge(id, idFromName(st.Next));
          break;
        }
        case "Map":
        case "DistributedMap": {
          if (type === "DistributedMap")
            notes.push(
              `"${name}" is a Distributed Map; imported as a standard map — large-scale/S3 item sources need manual setup.`,
            );
          const proc = st.ItemProcessor ?? st.Iterator;
          const node: DarLikeNode = {
            ...base,
            kind: "map",
            itemsCode: st.ItemsPath
              ? `return ${translateJsonPath(st.ItemsPath)} ?? [];`
              : "return input;",
            body: proc ? build(proc) : emptyBody(),
            ...(typeof st.MaxConcurrency === "number"
              ? { maxConcurrency: st.MaxConcurrency }
              : {}),
            ...(typeof st.ToleratedFailureCount === "number"
              ? { toleratedFailureCount: st.ToleratedFailureCount }
              : {}),
            ...(typeof st.ToleratedFailurePercentage === "number"
              ? { toleratedFailurePercentage: st.ToleratedFailurePercentage }
              : {}),
          };
          if (st.ItemsPath)
            todos.push({
              nodeId: id,
              kind: "map",
              field: "itemsCode",
              name,
              description: `Return the array to iterate over. ASL ItemsPath: ${st.ItemsPath}. ASL state: ${frag(st)}`,
            });
          markTerminal(node);
          nodes.push(node);
          if (st.Next) edge(id, idFromName(st.Next));
          break;
        }
        case "Succeed": {
          nodes.push({ ...base, kind: "end" });
          break;
        }
        case "Fail": {
          // Succeed and Fail used to collapse onto the same bare `end` node. With
          // no endMode, codegen emits a `return` (generateHandler's emitEnd), so
          // EVERY imported Fail state became a successful termination — the
          // execution reports SUCCEEDED where the state machine failed, and any
          // caller branching on that is silently wrong. Error and Cause were
          // dropped too, so the reason vanished as well.
          const errName =
            typeof st.Error === "string" && st.Error.trim() !== ""
              ? st.Error.trim()
              : "States.TaskFailed";
          const cause =
            typeof st.Cause === "string" && st.Cause.trim() !== ""
              ? st.Cause.trim()
              : undefined;
          // Emitted as a code block so the name and cause survive as data; an
          // ASL error name is not a JS class, so it cannot become a throw type.
          const msg = cause ? `${errName}: ${cause}` : errName;
          nodes.push({
            ...base,
            kind: "end",
            endMode: "throw",
            code: `throw new Error(${JSON.stringify(msg)});`,
          });
          break;
        }
        default: {
          notes.push(
            `"${name}" has unsupported Type "${type}"; imported as a pass-through step.`,
          );
          const node: DarLikeNode = {
            ...base,
            kind: "step",
            code: "return input;",
          };
          nodes.push(node);
          if (st.Next) edge(id, idFromName(st.Next));
          break;
        }
      }
    });

    return {
      darVersion: "1.0",
      name: m.Comment?.slice(0, 60) ?? "Imported workflow",
      ...(m.Comment ? { comment: m.Comment } : {}),
      // "dag" is an editor-only guardrail (lets a node fan out to multiple
      // next-nodes without auto-rerouting); the SDK itself has no such mode,
      // and defaulting every import to it was unconditional regardless of
      // whether the source ASL actually branches. Default to "linear" like
      // every other creation path (agent-generated, blank/new); this isn't a
      // one-way door — it only affects future imports.
      dependencyMode: "linear",
      nodes,
      edges,
    };
  };

  const workflow = build(machine);
  return { workflow, todos, notes };
}
