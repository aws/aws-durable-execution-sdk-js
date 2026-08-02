/**
 * The Workflow Studio inspector: edits the currently selected node. Composed of
 * several field widgets (name, retry/wait strategy, duration, condition
 * branches) plus the per-kind property panels.
 */
import { useEffect, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import Spinner from "@cloudscape-design/components/spinner";
import Textarea from "@cloudscape-design/components/textarea";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { CodeArea, CodeField } from "./CodeField";
import { CodeEditorModal } from "./CodeEditorModal";
import type { CodeKind } from "./monacoSetup";
import { AwsJobParams } from "./AwsJobParams";
import { DagConfigFields } from "./DagConfigPanel";
import { DURATION_UNITS, END_SENTINEL, TRIGGER_RULE_LABELS } from "./constants";
import { getServiceIntegration } from "@aws/durable-execution-sdk-js-visual-workflow-model";
import {
  NODE_KIND_LABELS,
  isOperationKind,
  makeUniqueName,
  newId,
  starterWorkflow,
  toIdentifier,
  inferDependencyKind,
  TRIGGER_RULES,
  upstreamResultNames,
  HTTP_METHODS,
  HTTP_AUTH_KINDS,
} from "../studioTypes";
import type {
  DarEdge,
  DarNode,
  DurationUnit,
  ErrorBranch,
  JitterKind,
  NestingKind,
  RetryStrategySpec,
  StrategyKind,
  TriggerRule,
} from "../studioTypes";

function unitOption(u: DurationUnit) {
  return { label: u, value: u };
}

/** Node kinds that support error handling. */
const ERROR_SUPPORTED = new Set<DarNode["kind"]>([
  "step",
  "inline",
  "callback",
  "chainInvoke",
  "waitForCondition",
  "map",
  "group",
  "parallel",
  "awsJob",
]);

const STRATEGY_OPTIONS: { label: string; value: StrategyKind }[] = [
  { label: "Exponential backoff", value: "exponential" },
  { label: "Linear backoff", value: "linear" },
  { label: "No retries", value: "none" },
];
const JITTER_OPTIONS: { label: string; value: JitterKind }[] = [
  { label: "Full", value: "FULL" },
  { label: "Half", value: "HALF" },
  { label: "None", value: "NONE" },
];
const NESTING_OPTIONS: { label: string; value: NestingKind }[] = [
  { label: "Nested (full checkpointing)", value: "NESTED" },
  { label: "Flat (cheaper, no per-item checkpoint)", value: "FLAT" },
];

/**
 * DAG-mode-only task section for the inspector: the node's incoming
 * dependencies (each showing its auto-inferred kind — "result" or "after" — as
 * a read-only label), its trigger rule, and its run-if predicate. Rendered only
 * when the active scope is `dag` mode and the node is an operation kind (P3.3);
 * hidden entirely in linear mode. The run-if code field is passed in from the
 * parent so it can share the parent's Monaco editor plumbing.
 */
function DagTaskSection({
  node,
  nodes,
  edges,
  onChange,
  runIfField,
}: {
  node: DarNode;
  nodes: DarNode[];
  edges: DarEdge[];
  onChange: (patch: Partial<DarNode>) => void;
  runIfField: React.ReactNode;
}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Dependencies are the node's incoming flow edges. Error routes run only on
  // failure and are edited in the Error handling section, so they're excluded.
  const incoming = edges.filter(
    (e) => e.target === node.id && e.kind !== "error",
  );
  const triggerRule: TriggerRule = node.triggerRule ?? "ALL_SUCCESS";
  return (
    <ExpandableSection
      variant="default"
      defaultExpanded
      headerText="DAG dependencies"
      headerDescription="Multiple-dependency (DAG) task settings for this scope."
    >
      <SpaceBetween size="m">
        <FormField
          label="Dependencies"
          description="Incoming edges this task waits on. The kind is auto-inferred: “result” when this task's code references the source (its value is passed via deps[…]); otherwise “after” — a wait-only ordering dependency (the SDK's .after())."
        >
          <SpaceBetween size="xs">
            {incoming.length === 0 && (
              <Box color="text-status-inactive" fontSize="body-s">
                No dependencies — this is a root task (deps: []).
              </Box>
            )}
            {incoming.map((e) => {
              const src = byId.get(e.source);
              // Auto-inferred (shared with codegen + canvas): result when this
              // node's code references the source, else ordering. An explicit
              // edge.dependencyKind override still wins inside the helper.
              const kind = inferDependencyKind({
                targetNode: node as unknown as Record<string, unknown>,
                sourceName: src?.name ?? "",
                explicit: e.dependencyKind,
              });
              const kindLabel = kind === "ordering" ? "after" : "result";
              return (
                <div
                  key={e.id}
                  style={{ display: "flex", gap: 6, alignItems: "center" }}
                >
                  <div
                    style={{
                      flex: "1 1 auto",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: 13,
                    }}
                    title={src?.name || "(unknown)"}
                  >
                    {src?.name || "(unknown)"}
                  </div>
                  <Box
                    fontSize="body-s"
                    color={
                      kind === "ordering"
                        ? "text-status-inactive"
                        : "text-status-info"
                    }
                  >
                    {kindLabel}
                  </Box>
                </div>
              );
            })}
          </SpaceBetween>
        </FormField>
        <FormField
          label="Trigger rule"
          description="When this task runs relative to its dependencies."
        >
          <Select
            selectedOption={{
              value: triggerRule,
              label: TRIGGER_RULE_LABELS[triggerRule],
            }}
            options={TRIGGER_RULES.map((r) => ({
              value: r,
              label: TRIGGER_RULE_LABELS[r],
            }))}
            onChange={({ detail }) => {
              const v = detail.selectedOption.value as TriggerRule;
              // Store by omission when the default so files stay clean.
              onChange({
                triggerRule: v === "ALL_SUCCESS" ? undefined : v,
              } as Partial<DarNode>);
            }}
          />
        </FormField>
        {runIfField}
      </SpaceBetween>
    </ExpandableSection>
  );
}

/** Editor for a retry/wait {@link RetryStrategySpec}, matching the SDK builders. */
function StrategyEditor({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: RetryStrategySpec;
  onChange: (s: RetryStrategySpec) => void;
}) {
  const set = (patch: Partial<RetryStrategySpec>) =>
    onChange({ ...value, ...patch });
  const numField = (
    field: "maxAttempts" | "initialDelaySeconds" | "maxDelaySeconds" | "incrementSeconds" | "backoffRate",
    min: number,
    step?: number,
  ) => (
    <Input
      type="number"
      step={step}
      value={String(value[field])}
      onChange={({ detail }) => {
        const n = Number(detail.value);
        set({ [field]: Number.isFinite(n) ? Math.max(min, n) : min } as Partial<RetryStrategySpec>);
      }}
    />
  );
  const strategyLabel =
    STRATEGY_OPTIONS.find((o) => o.value === value.kind)?.label ?? value.kind;
  return (
    <ExpandableSection
      variant="default"
      headerText={label}
      headerDescription={strategyLabel}
    >
      <SpaceBetween size="s">
        {description && (
          <Box fontSize="body-s" color="text-status-inactive">
            {description}
          </Box>
        )}
        <FormField label="Strategy">
          <Select
            selectedOption={
              STRATEGY_OPTIONS.find((o) => o.value === value.kind) ??
              STRATEGY_OPTIONS[0]
            }
            options={STRATEGY_OPTIONS}
            onChange={({ detail }) =>
              set({ kind: detail.selectedOption.value as StrategyKind })
            }
          />
        </FormField>
        {value.kind !== "none" && (
          <>
            <FormField
              label="Max attempts"
              description="Total attempts, including the initial one."
            >
              {numField("maxAttempts", 1)}
            </FormField>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <FormField label="Initial delay (s)">
                  {numField("initialDelaySeconds", 0)}
                </FormField>
              </div>
              <div style={{ flex: 1 }}>
                <FormField label="Max delay (s)">
                  {numField("maxDelaySeconds", 1)}
                </FormField>
              </div>
            </div>
            {value.kind === "exponential" && (
              <FormField
                label="Backoff rate"
                description="delay × rate^(attempt − 1)"
              >
                {numField("backoffRate", 1, 0.1)}
              </FormField>
            )}
            {value.kind === "linear" && (
              <FormField
                label="Increment (s)"
                description="added to the delay each attempt"
              >
                {numField("incrementSeconds", 0)}
              </FormField>
            )}
            <FormField label="Jitter">
              <Select
                selectedOption={
                  JITTER_OPTIONS.find((o) => o.value === value.jitter) ??
                  JITTER_OPTIONS[0]
                }
                options={JITTER_OPTIONS}
                onChange={({ detail }) =>
                  set({ jitter: detail.selectedOption.value as JitterKind })
                }
              />
            </FormField>
          </>
        )}
      </SpaceBetween>
    </ExpandableSection>
  );
}

/**
 * Name input that keeps operation names unique. Edits are buffered locally and
 * committed on blur/Enter; on commit a colliding name is auto-suffixed
 * (`foo` → `foo-2`) so the model can never hold two nodes with the same name.
 */
function NameField({
  value,
  otherNames,
  enforce,
  onCommit,
}: {
  value: string;
  otherNames: Set<string>;
  enforce: boolean;
  onCommit: (name: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const trimmed = text.trim();
  const duplicate = enforce && trimmed.length > 0 && otherNames.has(trimmed);
  const empty = enforce && trimmed.length === 0;
  const commit = () => {
    if (!enforce) {
      onCommit(text);
      return;
    }
    if (trimmed.length === 0) {
      setText(value); // revert empty back to the previous name
      return;
    }
    const unique = makeUniqueName(trimmed, otherNames);
    onCommit(unique);
    setText(unique);
  };
  return (
    <FormField
      label="Name"
      description="Becomes the durable operation name."
      errorText={
        duplicate
          ? "Another node already uses this name — it will be made unique."
          : empty
            ? "Name can't be empty."
            : undefined
      }
    >
      <Input
        value={text}
        onChange={({ detail }) => setText(detail.value)}
        onBlur={commit}
        onKeyDown={({ detail }) => {
          if (detail.key === "Enter") commit();
        }}
      />
    </FormField>
  );
}

function BranchEditor({
  node,
  nodes,
  edges,
  onAddBranch,
  onSetBranch,
  onEndBranch,
  onDeleteBranch,
}: {
  node: DarNode;
  nodes: DarNode[];
  edges: DarEdge[];
  onAddBranch: (source: string, target: string, match: string) => void;
  onSetBranch: (
    edgeId: string,
    patch: Partial<Pick<DarEdge, "match" | "target" | "errorType">>,
  ) => void;
  onEndBranch: (conditionId: string, edgeId: string) => void;
  onDeleteBranch: (edgeId: string) => void;
}) {
  // A condition's branches are its non-error outgoing edges; `match` is the
  // value to match, and a matchless edge is the else (default) branch.
  const branches = edges.filter(
    (e) => e.source === node.id && e.kind !== "error",
  );
  const matchBranches = branches.filter((e) => (e.match ?? "").trim());
  const elseBranches = branches.filter((e) => !(e.match ?? "").trim());
  // Eligible targets: any node except this one, start, and end markers.
  const targets = nodes.filter(
    (n) => n.id !== node.id && n.kind !== "start" && n.kind !== "end",
  );
  const firstTarget = targets[0]?.id;
  const toOption = (n: DarNode) => ({
    label: `${n.name || "(unnamed)"} · ${NODE_KIND_LABELS[n.kind]}`,
    value: n.id,
  });
  const endOption = { label: "⟶ End workflow", value: END_SENTINEL };
  const options = [...targets.map(toOption), endOption];

  const selectFor = (edge: DarEdge) => {
    const targetNode = nodes.find((n) => n.id === edge.target);
    if (targetNode?.kind === "end") return endOption;
    return (
      options.find((o) => o.value === edge.target) ??
      (targetNode ? toOption(targetNode) : null)
    );
  };
  const onTarget = (edge: DarEdge, value: string) =>
    value === END_SENTINEL
      ? onEndBranch(node.id, edge.id)
      : onSetBranch(edge.id, { target: value });
  const targetSelect = (edge: DarEdge) => (
    <Select
      selectedOption={selectFor(edge)}
      options={options}
      onChange={({ detail }) =>
        onTarget(edge, detail.selectedOption.value as string)
      }
    />
  );
  const removeBtn = (edge: DarEdge, aria: string) => (
    <Button
      iconName="close"
      variant="icon"
      ariaLabel={aria}
      onClick={() => onDeleteBranch(edge.id)}
    />
  );

  return (
    <FormField
      label="Branches"
      description="Each branch routes to a target when the expression equals its match. The else branch handles all other results; a branch can also end the workflow."
    >
      <SpaceBetween size="xs">
        {branches.length === 0 && (
          <Box color="text-status-inactive" fontSize="body-s">
            No branches yet — add one below.
          </Box>
        )}
        {matchBranches.map((edge) => (
          <div
            key={edge.id}
            style={{ display: "flex", gap: 6, alignItems: "flex-start" }}
          >
            <div style={{ flex: "1 1 40%" }}>
              <Input
                value={edge.match ?? ""}
                placeholder="match value"
                onChange={({ detail }) =>
                  onSetBranch(edge.id, { match: detail.value })
                }
              />
            </div>
            <div style={{ flex: "1 1 60%" }}>{targetSelect(edge)}</div>
            {removeBtn(edge, "Remove branch")}
          </div>
        ))}
        {elseBranches.map((edge) => (
          <div
            key={edge.id}
            style={{ display: "flex", gap: 6, alignItems: "center" }}
          >
            <div
              style={{
                flex: "1 1 40%",
                fontSize: 12,
                fontStyle: "italic",
                color: "#8b949e",
              }}
            >
              else (all other results)
            </div>
            <div style={{ flex: "1 1 60%" }}>{targetSelect(edge)}</div>
            {removeBtn(edge, "Remove else branch")}
          </div>
        ))}
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            iconName="add-plus"
            disabled={!firstTarget}
            onClick={() =>
              onAddBranch(
                node.id,
                firstTarget as string,
                makeUniqueName(
                  "value",
                  new Set(matchBranches.map((e) => (e.match ?? "").trim())),
                ),
              )
            }
          >
            Add branch
          </Button>
          <Button
            disabled={!firstTarget || elseBranches.length > 0}
            onClick={() => onAddBranch(node.id, firstTarget as string, "")}
          >
            Add else branch
          </Button>
        </div>
      </SpaceBetween>
    </FormField>
  );
}

/**
 * Shared "Completion config" section (early-completion thresholds) used by the
 * map and parallel inspectors. Blank fields clear the value (undefined).
 */
function CompletionConfigSection({
  minSuccessful,
  toleratedFailureCount,
  toleratedFailurePercentage,
  onChange,
}: {
  minSuccessful?: number;
  toleratedFailureCount?: number;
  toleratedFailurePercentage?: number;
  onChange: (patch: Partial<DarNode>) => void;
}) {
  const numPatch =
    (key: string, max?: number) =>
    ({ detail }: { detail: { value: string } }) => {
      const v = detail.value.trim();
      const n = Number(v);
      const val =
        v === "" || !Number.isFinite(n)
          ? undefined
          : max === undefined
            ? Math.max(0, n)
            : Math.min(max, Math.max(0, n));
      onChange({ [key]: val } as Partial<DarNode>);
    };
  return (
    <ExpandableSection
      variant="default"
      headerText="Completion config"
      headerDescription="Optional early-completion thresholds."
    >
      <SpaceBetween size="s">
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <FormField label="Min successful" description="blank = all.">
              <Input
                type="number"
                placeholder="all"
                value={
                  minSuccessful === undefined ? "" : String(minSuccessful)
                }
                onChange={numPatch("minSuccessful")}
              />
            </FormField>
          </div>
          <div style={{ flex: 1 }}>
            <FormField label="Tolerated failures" description="blank = 0.">
              <Input
                type="number"
                placeholder="0"
                value={
                  toleratedFailureCount === undefined
                    ? ""
                    : String(toleratedFailureCount)
                }
                onChange={numPatch("toleratedFailureCount")}
              />
            </FormField>
          </div>
        </div>
        <FormField
          label="Tolerated failure %"
          description="percentage 0-100 (blank = unused)."
        >
          <Input
            type="number"
            placeholder="unused"
            value={
              toleratedFailurePercentage === undefined
                ? ""
                : String(toleratedFailurePercentage)
            }
            onChange={numPatch("toleratedFailurePercentage", 100)}
          />
        </FormField>
      </SpaceBetween>
    </ExpandableSection>
  );
}

/**
 * Cheap check for whether a value field holds STATEMENTS rather than a single
 * expression, used only to pick which editor scaffold to show. Codegen makes the
 * authoritative decision by actually parsing (see `generateHandler`'s
 * `isExpressionText`); this just has to be right for ordinary input, and a wrong
 * guess costs a squiggle until the editor is reopened, never a bad build.
 */
function looksLikeStatements(text: string): boolean {
  const t = text.trim();
  if (t === "") return false;
  return /\breturn\b|\b(const|let|var|if|for|while|throw)\b|;/.test(t);
}

export function NodeInspector({
  node,
  nodes,
  edges,
  scopeSymbols,
  onChange,
  inputType,
  onApplyCode,
  onSetTerminal,
  onAddBranch,
  onAddErrorRoute,
  onSetBranch,
  onEndBranch,
  onDeleteBranch,
  onEnterContainer,
  dagMode,
  onGenerateNodeCode,
  onListResources,
  onInferTypes,
  onApplyResultTypes,
  onSetInputType,
}: {
  node: DarNode;
  nodes: DarNode[];
  edges: DarEdge[];
  scopeSymbols: string[];
  onChange: (patch: Partial<DarNode>) => void;
  /** Root workflow input type, for typing `event`/`input` in the editor. */
  inputType?: string;
  /** Apply an edited code block back to the model by token. */
  onApplyCode: (token: string, content: string) => void;
  onSetTerminal: (nodeId: string, terminal: boolean) => void;
  onAddBranch: (source: string, target: string, match: string) => void;
  /** Add an `"error"`-kind edge: taken when `source` fails with `errorType`. */
  onAddErrorRoute: (source: string, target: string, errorType: string) => void;
  onSetBranch: (
    edgeId: string,
    patch: Partial<Pick<DarEdge, "match" | "target" | "errorType">>,
  ) => void;
  onEndBranch: (conditionId: string, edgeId: string) => void;
  onDeleteBranch: (edgeId: string) => void;
  onEnterContainer: (id: string) => void;
  /** True when the active scope is in DAG mode — gates the DAG task section
   *  (dependencies / trigger rule / run-if). Absent/false = linear mode. */
  dagMode?: boolean;
  onGenerateNodeCode?: (req: {
    kind: string;
    field: string;
    name: string;
    description: string;
    scope: string[];
    currentCode?: string;
  }) => Promise<string>;
  onListResources?: (resource: string) => Promise<{
    items: { label: string; value: string }[];
    error?: string;
  }>;
  onInferTypes?: (
    items: {
      nodeId: string;
      resultName: string;
      code: string;
      codeKind: "step" | "condition";
      scope: string[];
    }[],
    seedTypes?: Record<string, string>,
  ) => Promise<Record<string, string>>;
  /** Apply inferred result types back to nodes by id (undefined clears). */
  onApplyResultTypes?: (types: Record<string, string | undefined>) => void;
  /** Set the workflow-level input type (edited from the start node). */
  onSetInputType?: (value: string) => void;
}) {
  // Everything the node's code can reference, declared in the "Edit in VS Code"
  // scaffold: scope symbols (event/input at root, item/index in a map body),
  // `err` when this node is an error-route target, and upstream result consts.
  const isErrorTarget = edges.some(
    (e) => e.kind === "error" && e.target === node.id,
  );
  // Author-declared result types, keyed by result-const identifier, so the
  // built-in editor can type each upstream `declare const` precisely.
  const codeScopeTypes: Record<string, string> = {};
  for (const n of nodes) {
    if (
      isOperationKind(n.kind) &&
      typeof n.resultType === "string" &&
      n.resultType.trim().length > 0
    ) {
      codeScopeTypes[toIdentifier(n.name)] = n.resultType.trim();
    }
  }

  // DAG scope: a task's editor exposes only its DIRECT dependencies — the
  // source nodes of its incoming flow edges (non-error), including ordering
  // ("after") edges, since referencing an ordering dep is exactly what flips
  // it to "result". The generated body is
  //   async (deps, ctx) => { const <src> = deps["<src>"]; <body> }
  // so BOTH a typed `deps` map (keyed by each source's RAW name) and the bare
  // const aliases the shim injects are real at runtime. Unlike linear, a DAG
  // task does NOT see transitive ancestors as bare consts.
  const isDagOperation = !!dagMode && isOperationKind(node.kind);
  const dagDirectDeps = isDagOperation
    ? (() => {
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const seen = new Set<string>();
        const deps: { rawName: string; identifier: string; type: string }[] =
          [];
        for (const e of edges) {
          if (e.kind === "error" || e.target !== node.id) continue;
          const src = byId.get(e.source);
          if (!src || !isOperationKind(src.kind)) continue;
          const identifier = toIdentifier(src.name);
          if (seen.has(identifier)) continue;
          seen.add(identifier);
          const rt =
            typeof src.resultType === "string" && src.resultType.trim().length > 0
              ? src.resultType.trim()
              : "any";
          deps.push({ rawName: src.name, identifier, type: rt });
        }
        return deps;
      })()
    : [];
  // TS object-type literal for the `deps` map. Keys are the RAW dependency
  // names; a key that is already a valid JS identifier is emitted unquoted
  // (so `deps.step2` reads naturally), otherwise it is quoted (e.g.
  // `"fetch-users"`). Undefined in linear scopes (and DAG root tasks with no
  // deps) so the scaffold omits it.
  const depsKey = (name: string) =>
    /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
  const depsType =
    dagDirectDeps.length > 0
      ? `{ ${dagDirectDeps
          .map((d) => `${depsKey(d.rawName)}: ${d.type}`)
          .join("; ")} }`
      : undefined;

  const codeScope = isDagOperation
    ? [
        ...scopeSymbols,
        ...(isErrorTarget ? ["err"] : []),
        // DAG: only direct-dep bare consts (NOT transitive upstreamResultNames).
        ...dagDirectDeps.map((d) => d.identifier),
      ]
    : [
        ...scopeSymbols,
        ...(isErrorTarget ? ["err"] : []),
        ...upstreamResultNames(nodes, edges, node.id),
      ];

  // Built-in code editor (Monaco modal). Opening captures the field token,
  // codeKind and current value; closing saves the value and — for a node whose
  // result IS its code's return value (step / waitForCondition) — silently
  // refreshes the node's result type from the new code.
  const [editing, setEditing] = useState<{
    token: string;
    value: string;
    codeKind: CodeKind;
    title: string;
  } | null>(null);
  const openEditor = (
    token: string,
    value: string,
    codeKind: CodeKind,
    title: string,
  ) => setEditing({ token, value: value ?? "", codeKind, title });
  // When a node's code changes we re-infer result types for ALL inferable
  // nodes at this level in dependency order (one host call — inferResultTypes
  // feeds each result type forward), so downstream nodes don't keep a stale
  // type. Only runs at discrete code-change points (editor close, agent write),
  // never continuously. (Nodes inside nested containers are not cascaded yet.)
  const inferResultFromCode = async (changedNodeId: string, freshCode: string) => {
    if (!onInferTypes || !onApplyResultTypes) return;
    const inferable = nodes.filter(
      (n) =>
        (n.kind === "step" ||
          n.kind === "inline" ||
          n.kind === "waitForCondition") &&
        typeof (n as { code?: unknown }).code === "string",
    );
    if (inferable.length === 0) return;

    // Dependency order: a node comes after every inferable node it references.
    const idByName = new Map(inferable.map((n) => [toIdentifier(n.name), n.id]));
    const deps = new Map(
      inferable.map((n) => [
        n.id,
        new Set(
          upstreamResultNames(nodes, edges, n.id)
            .map((name) => idByName.get(name))
            .filter((x): x is string => !!x),
        ),
      ]),
    );
    const ordered: DarNode[] = [];
    const done = new Set<string>();
    while (ordered.length < inferable.length) {
      const next =
        inferable.find(
          (n) =>
            !done.has(n.id) &&
            [...(deps.get(n.id) ?? [])].every((d) => done.has(d)),
        ) ?? inferable.find((n) => !done.has(n.id));
      if (!next) break;
      ordered.push(next);
      done.add(next.id);
    }

    const seed: Record<string, string> = {};
    for (const n of nodes) {
      const rt = n.resultType?.trim();
      if (rt) seed[toIdentifier(n.name)] = rt;
    }
    const items = ordered.map((n) => ({
      nodeId: n.id,
      resultName: toIdentifier(n.name),
      code:
        n.id === changedNodeId
          ? freshCode
          : ((n as { code?: string }).code ?? ""),
      codeKind: (n.kind === "waitForCondition" ? "condition" : "step") as
        | "step"
        | "condition",
      scope: [
        ...scopeSymbols,
        ...(edges.some((e) => e.kind === "error" && e.target === n.id)
          ? ["err"]
          : []),
        // DAG scope: expose `deps` so a body referencing deps["x"] resolves
        // (the host types every scope name as `any`, so deps becomes `any`
        // there rather than an unresolved name that could wreck inference).
        // The webview scaffold types deps precisely; inference stays best-effort
        // and never regresses linear (deps is only added in DAG mode).
        ...(dagMode ? ["deps"] : []),
        ...upstreamResultNames(nodes, edges, n.id),
      ],
    }));
    const types = await onInferTypes(items, seed);
    const applied: Record<string, string | undefined> = {};
    for (const n of ordered) applied[n.id] = types[n.id] || undefined;
    onApplyResultTypes(applied);
  };
  const closeEditor = async (finalValue: string) => {
    const current = editing;
    setEditing(null);
    if (!current) return;
    onApplyCode(current.token, finalValue);
    if (current.token === `${node.id}::code`) {
      await inferResultFromCode(node.id, finalValue);
    }
  };

  // "Agent" code generation modal (per code field).
  const [agent, setAgent] = useState<{
    field: string;
    label: string;
    current: string;
  } | null>(null);
  const [agentDesc, setAgentDesc] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState("");
  const openAgent = (field: string, label: string, current: string) => {
    setAgent({ field, label, current });
    setAgentDesc("");
    setAgentError("");
  };
  const agentFor = onGenerateNodeCode
    ? (field: string, label: string, current: string) => () =>
        openAgent(field, label, current)
    : undefined;
  const runAgent = async () => {
    if (!onGenerateNodeCode || !agent || !agentDesc.trim()) return;
    setAgentBusy(true);
    setAgentError("");
    try {
      const code = await onGenerateNodeCode({
        kind: node.kind,
        field: agent.field,
        name: node.name,
        description: agentDesc.trim(),
        scope: codeScope,
        currentCode: agent.current,
      });
      onChange({ [agent.field]: code } as Partial<DarNode>);
      setAgent(null);
      // The node's real code just changed — refresh its result type once (same
      // as closing the editor), so downstream nodes see the correct type.
      if (agent.field === "code") await inferResultFromCode(node.id, code);
    } catch (e) {
      setAgentError(e instanceof Error ? e.message : String(e));
    } finally {
      setAgentBusy(false);
    }
  };
  return (
    <SpaceBetween size="m">
      {editing && (
        <CodeEditorModal
          open={!!editing}
          title={editing.title}
          value={editing.value}
          codeKind={editing.codeKind}
          scope={codeScope}
          scopeTypes={codeScopeTypes}
          inputType={inputType}
          depsType={depsType}
          onClose={(v) => {
            void closeEditor(v);
          }}
        />
      )}
      <NameField
        value={node.name}
        enforce={isOperationKind(node.kind)}
        otherNames={new Set(
          nodes
            .filter((n) => isOperationKind(n.kind) && n.id !== node.id)
            .map((n) => n.name.trim())
            .filter((n) => n.length > 0),
        )}
        onCommit={(name) => onChange({ name } as Partial<DarNode>)}
      />

      <FormField label="Comment" description="Optional description (kept in the file, emitted above the generated code).">
        <Input
          value={node.comment ?? ""}
          placeholder="What this node does…"
          onChange={({ detail }) =>
            onChange({
              comment: detail.value === "" ? undefined : detail.value,
            } as Partial<DarNode>)
          }
        />
      </FormField>

      {node.kind === "start" && onSetInputType && (
        <FormField
          label="Event / input type"
          description="Types the workflow's `event`/`input` payload. Edited in the Config view — it belongs to the workflow, not to this node."
        >
          <Box variant="code" color="text-status-inactive">
            {(inputType ?? "").trim() === "" ? "any" : inputType}
          </Box>
        </FormField>
      )}

      {!dagMode &&
        node.kind !== "start" &&
        node.kind !== "end" &&
        node.kind !== "condition" && (
          <Checkbox
            checked={!!node.terminal}
            onChange={({ detail }) => onSetTerminal(node.id, detail.checked)}
          >
            End the workflow after this node
          </Checkbox>
        )}

      {dagMode && isOperationKind(node.kind) && (
        <DagTaskSection
          node={node}
          nodes={nodes}
          edges={edges}
          onChange={onChange}
          runIfField={
            <CodeField
              label="Run if (TypeScript predicate over deps)"
              description="Optional. Emitted as { runIf: (deps) => <expr> } — the task is skipped when it returns false."
              value={node.runIf ?? ""}
              onEdit={() =>
                openEditor(
                  `${node.id}::runIf`,
                  node.runIf ?? "",
                  "condition",
                  "Edit run-if predicate",
                )
              }
              onAgent={agentFor?.("runIf", "run-if predicate", node.runIf ?? "")}
            />
          }
        />
      )}

      {node.kind === "end" && (
        <>
          <FormField
            label="On workflow end"
            description="Return data to the caller, or throw an error to fail the execution."
          >
            <Select
              selectedOption={
                node.endMode === "throw"
                  ? { value: "throw", label: "Throw error" }
                  : { value: "return", label: "Return data" }
              }
              options={[
                { value: "return", label: "Return data" },
                { value: "throw", label: "Throw error" },
              ]}
              onChange={({ detail }) =>
                onChange({
                  endMode: detail.selectedOption.value as "return" | "throw",
                } as Partial<DarNode>)
              }
            />
          </FormField>
          <CodeField
            label={
              node.endMode === "throw"
                ? "Throw code (TypeScript)"
                : "Return code (TypeScript)"
            }
            description={
              node.endMode === "throw"
                ? 'e.g. throw new Error("Rejected"). Blank throws a default error.'
                : "e.g. return { ok: true }. Blank returns the previous node's result."
            }
            value={node.code ?? ""}
            onEdit={() =>
              openEditor(`${node.id}::code`, node.code ?? "", "step", "Edit code")
            }
            onAgent={agentFor?.("code", "end code", node.code ?? "")}
          />
        </>
      )}

      {node.kind === "step" && (
        <>
          <CodeField
            label="TypeScript code"
            description="Runs inside context.step(name, async () => { … })."
            value={node.code}
            onEdit={() =>
              openEditor(`${node.id}::code`, node.code, "step", "Edit step code")
            }
            onAgent={agentFor?.("code", "step code", node.code)}
          />
          <StrategyEditor
            label="Retry strategy"
            description="Applied on step failure (createRetryStrategy / createLinearRetryStrategy)."
            value={node.retry}
            onChange={(retry) => onChange({ retry } as Partial<DarNode>)}
          />
        </>
      )}

      {node.kind === "inline" && (
        <>
          <CodeField
            label="TypeScript code"
            description="Runs inline (no checkpoint) — must be deterministic and side-effect-free, since it re-runs on every replay. Its returned value is available to downstream nodes. Use a Step for anything non-deterministic or I/O."
            value={node.code}
            onEdit={() =>
              openEditor(
                `${node.id}::code`,
                node.code,
                "step",
                "Edit inline code",
              )
            }
            onAgent={agentFor?.("code", "inline code", node.code)}
          />
        </>
      )}

      {node.kind === "waitForCondition" && (
        <>
          <CodeField
            label="Condition code (TypeScript)"
            description="Return the next polling state."
            value={node.code}
            onEdit={() =>
              openEditor(`${node.id}::code`, node.code, "condition", "Edit condition code")
            }
            onAgent={agentFor?.("code", "condition check", node.code)}
          />
          <FormField label="Initial state (JSON)">
            <CodeArea
              value={node.initialState}
              rows={3}
              onChange={(initialState) =>
                onChange({ initialState } as Partial<DarNode>)
              }
            />
          </FormField>
          <FormField
            label="Stop when (TypeScript expression)"
            description="Boolean over `state`; polling stops when it is truthy."
          >
            <SpaceBetween size="xs">
              <CodeArea
                value={node.stopCondition}
                rows={2}
                onChange={(stopCondition) =>
                  onChange({ stopCondition } as Partial<DarNode>)
                }
              />
              {agentFor && (
                <Button
                  iconName="gen-ai"
                  onClick={agentFor(
                    "stopCondition",
                    "stop condition",
                    node.stopCondition,
                  )}
                >
                  Agent
                </Button>
              )}
            </SpaceBetween>
          </FormField>
          <StrategyEditor
            label="Polling strategy"
            description="How the delay between condition checks grows (createWaitStrategy)."
            value={node.wait}
            onChange={(wait) => onChange({ wait } as Partial<DarNode>)}
          />
        </>
      )}

      {node.kind === "condition" && (
        <>
          <CodeField
            label="Expression (TypeScript)"
            description="Return a value; the workflow routes to the branch whose match equals it."
            value={node.code}
            onEdit={() =>
              openEditor(`${node.id}::code`, node.code, "step", "Edit step code")
            }
            onAgent={agentFor?.("code", "condition expression", node.code)}
          />
          <BranchEditor
            node={node}
            nodes={nodes}
            edges={edges}
            onAddBranch={onAddBranch}
            onSetBranch={onSetBranch}
            onEndBranch={onEndBranch}
            onDeleteBranch={onDeleteBranch}
          />
        </>
      )}

      {node.kind === "map" && (
        <>
          <CodeField
            label="Items (TypeScript)"
            description="Return the array to iterate over; the body runs once per element (bound as `item`)."
            value={node.itemsCode}
            onEdit={() =>
              openEditor(`${node.id}::itemsCode`, node.itemsCode, "step", "Edit items code")
            }
            onAgent={agentFor?.("itemsCode", "map items", node.itemsCode)}
          />
          <FormField
            label="Max concurrency"
            description="How many iterations run in parallel."
          >
            <Input
              type="number"
              value={String(node.maxConcurrency)}
              onChange={({ detail }) => {
                const n = Number(detail.value);
                onChange({
                  maxConcurrency: Number.isFinite(n) ? Math.max(1, n) : 1,
                } as Partial<DarNode>);
              }}
            />
          </FormField>
          <CompletionConfigSection
            minSuccessful={node.minSuccessful}
            toleratedFailureCount={node.toleratedFailureCount}
            toleratedFailurePercentage={node.toleratedFailurePercentage}
            onChange={onChange}
          />
          <FormField
            label="Iteration nesting"
            description="Flat skips per-iteration checkpointing (~30% cheaper); Nested is the default."
          >
            <Select
              selectedOption={
                NESTING_OPTIONS.find((o) => o.value === (node.nesting ?? "NESTED")) ??
                NESTING_OPTIONS[0]
              }
              options={NESTING_OPTIONS}
              onChange={({ detail }) =>
                onChange({
                  nesting: detail.selectedOption.value as NestingKind,
                } as Partial<DarNode>)
              }
            />
          </FormField>
          <Box color="text-status-inactive" fontSize="body-s">
            Runs a child workflow for each item — {node.body.nodes.length} node
            {node.body.nodes.length === 1 ? "" : "s"} in the body.
          </Box>
          <Button iconName="edit" onClick={() => onEnterContainer(node.id)}>
            Edit iteration workflow →
          </Button>
        </>
      )}

      {node.kind === "group" && (
        <>
          <Box color="text-status-inactive" fontSize="body-s">
            Groups a child workflow under a child context —{" "}
            {node.body.nodes.length} node
            {node.body.nodes.length === 1 ? "" : "s"} in the body.
          </Box>
          <Button iconName="edit" onClick={() => onEnterContainer(node.id)}>
            Edit workflow →
          </Button>
        </>
      )}

      {node.kind === "dagContainer" && (
        <>
          <Box color="text-status-inactive" fontSize="body-s">
            A DAG Container: its body is always a DAG scope (multiple
            dependencies, trigger rules, run-if). {node.body.nodes.length} node
            {node.body.nodes.length === 1 ? "" : "s"} in the body.
          </Box>
          <Button iconName="edit" onClick={() => onEnterContainer(node.id)}>
            Edit DAG workflow →
          </Button>
          <FormField
            label="DAG configuration"
            description="Applies to this container's DAG (context.dag(...))."
          >
            <DagConfigFields
              value={node.dagConfig}
              onChange={(next) =>
                onChange({ dagConfig: next } as Partial<DarNode>)
              }
            />
          </FormField>
        </>
      )}

      {node.kind === "parallel" && (
        <>
          <FormField
            label="Branches"
            description="Each branch runs concurrently as its own child workflow."
          >
            <SpaceBetween size="xs">
              {node.branches.map((b) => (
                <div
                  key={b.id}
                  style={{ display: "flex", gap: 6, alignItems: "flex-start" }}
                >
                  <div style={{ flex: 1 }}>
                    <Input
                      value={b.name}
                      onChange={({ detail }) =>
                        onChange({
                          branches: node.branches.map((x) =>
                            x.id === b.id ? { ...x, name: detail.value } : x,
                          ),
                        } as Partial<DarNode>)
                      }
                    />
                  </div>
                  <Button
                    iconName="edit"
                    onClick={() => onEnterContainer(b.id)}
                  >
                    Edit →
                  </Button>
                  <Button
                    iconName="close"
                    variant="icon"
                    ariaLabel="Remove branch"
                    disabled={node.branches.length <= 1}
                    onClick={() =>
                      onChange({
                        branches: node.branches.filter((x) => x.id !== b.id),
                      } as Partial<DarNode>)
                    }
                  />
                </div>
              ))}
              <Button
                iconName="add-plus"
                onClick={() =>
                  onChange({
                    branches: [
                      ...node.branches,
                      {
                        id: newId("b"),
                        name: `branch-${node.branches.length + 1}`,
                        body: starterWorkflow(),
                      },
                    ],
                  } as Partial<DarNode>)
                }
              >
                Add branch
              </Button>
            </SpaceBetween>
          </FormField>
          <FormField
            label="Max concurrency"
            description="How many branches run at once (blank = unlimited)."
          >
            <Input
              type="number"
              placeholder="unlimited"
              value={
                node.maxConcurrency === undefined
                  ? ""
                  : String(node.maxConcurrency)
              }
              onChange={({ detail }) => {
                const v = detail.value.trim();
                const n = Number(v);
                onChange({
                  maxConcurrency:
                    v === "" || !Number.isFinite(n)
                      ? undefined
                      : Math.max(1, n),
                } as Partial<DarNode>);
              }}
            />
          </FormField>
          <CompletionConfigSection
            minSuccessful={node.minSuccessful}
            toleratedFailureCount={node.toleratedFailureCount}
            toleratedFailurePercentage={node.toleratedFailurePercentage}
            onChange={onChange}
          />
        </>
      )}

      {node.kind === "wait" && (
        <>
          <DurationField
            label="Duration"
            value={node.durationValue}
            unit={node.durationUnit}
            onValue={(durationValue) =>
              onChange({ durationValue } as Partial<DarNode>)
            }
            onUnit={(durationUnit) =>
              onChange({ durationUnit } as Partial<DarNode>)
            }
          />
          <CodeField
            label="Dynamic duration (seconds)"
            description="Optional. A number of SECONDS, computed from upstream results — e.g. 12 or get_order.retryAfter. Overrides the static duration. Must be deterministic, so no awaiting."
            value={node.durationCode ?? ""}
            onEdit={() =>
              openEditor(
                `${node.id}::durationCode`,
                node.durationCode ?? "",
                // Both spellings are valid (see generateHandler's wait case), so
                // scaffold whichever the current content actually is: a bare
                // expression is the common form, but an existing `return …`
                // block must keep type-checking as one.
                looksLikeStatements(node.durationCode ?? "")
                  ? "duration"
                  : "durationExpression",
                "Edit dynamic duration",
              )
            }
          />
        </>
      )}

      {node.kind === "callback" && (
        <>
          <DurationField
            label="Timeout"
            value={node.timeoutValue}
            unit={node.timeoutUnit}
            onValue={(timeoutValue) =>
              onChange({ timeoutValue } as Partial<DarNode>)
            }
            onUnit={(timeoutUnit) =>
              onChange({ timeoutUnit } as Partial<DarNode>)
            }
          />
          <CodeField
            label="Submitter code (TypeScript)"
            description="Optional. Receives callbackId; sends it to the external system."
            value={node.submitterCode}
            onEdit={() =>
              openEditor(
                `${node.id}::submitterCode`,
                node.submitterCode,
                "submitter",
                "Edit submitter code",
              )
            }
            onAgent={agentFor?.(
              "submitterCode",
              "callback submitter",
              node.submitterCode,
            )}
          />
        </>
      )}

      {node.kind === "chainInvoke" && (
        <>
          <FormField
            label="Function ARN or name"
            description="Must be qualified with a version or alias."
          >
            <Input
              value={node.functionArn}
              onChange={({ detail }) =>
                onChange({ functionArn: detail.value } as Partial<DarNode>)
              }
            />
          </FormField>
          <FormField label="Payload (JSON)">
            <CodeArea
              value={node.payload}
              rows={4}
              onChange={(payload) =>
                onChange({ payload } as Partial<DarNode>)
              }
            />
          </FormField>
        </>
      )}

      {node.kind === "awsJob" &&
        (() => {
          const preset = getServiceIntegration(node.integration);
          return (
            <>
              <FormField
                label="Integration"
                description="Starts the job, then polls until it reaches a terminal status."
              >
                <Box>{preset ? preset.label : node.integration}</Box>
              </FormField>
              <AwsJobParams
                preset={preset}
                startInput={node.startInput}
                onListResources={onListResources}
                onChange={(startInput) =>
                  onChange({ startInput } as Partial<DarNode>)
                }
              />
              <FormField
                label="Poll interval (s)"
                description="Seconds between status checks."
              >
                <Input
                  type="number"
                  placeholder={
                    preset ? String(preset.defaultPollSeconds) : "10"
                  }
                  value={
                    node.pollIntervalSeconds === undefined
                      ? ""
                      : String(node.pollIntervalSeconds)
                  }
                  onChange={({ detail }) => {
                    const v = detail.value.trim();
                    const n = Number(v);
                    onChange({
                      pollIntervalSeconds:
                        v === "" || !Number.isFinite(n)
                          ? undefined
                          : Math.max(1, n),
                    } as Partial<DarNode>);
                  }}
                />
              </FormField>
              <FormField
                label="Region"
                description="Optional; defaults to the Lambda's region."
              >
                <Input
                  placeholder="(default)"
                  value={node.region ?? ""}
                  onChange={({ detail }) =>
                    onChange({
                      region: detail.value.trim() || undefined,
                    } as Partial<DarNode>)
                  }
                />
              </FormField>
              {preset && (
                <Box variant="small">
                  <b>Start:</b> {preset.start.command} · <b>Poll:</b>{" "}
                  {preset.poll.command}
                  <br />
                  <b>Succeeds on:</b> {preset.success.join(", ")} · <b>Fails on:</b>{" "}
                  {preset.failure.join(", ")}
                  <br />
                  <b>IAM:</b> {preset.iamActions.join(", ")}
                  {preset.notes ? (
                    <>
                      <br />
                      <b>Note:</b> {preset.notes}
                    </>
                  ) : null}
                </Box>
              )}
            </>
          );
        })()}

      {node.kind === "awsSdkCall" && (
        <>
          <FormField
            label="Operation"
            description="A single AWS SDK v3 call, wrapped in a durable step."
          >
            <Box>
              <b>{node.command.replace(/Command$/, "")}</b> · {node.clientClass}
              <br />
              <Box variant="small" color="text-status-inactive">
                {node.clientPackage}
              </Box>
            </Box>
          </FormField>
          <FormField
            label="Input payload (JSON)"
            description="Command input. Reflected from the SDK schema — fill in the values you need."
          >
            <Textarea
              value={node.input}
              onChange={({ detail }) =>
                onChange({ input: detail.value } as Partial<DarNode>)
              }
              rows={12}
            />
          </FormField>
          <FormField
            label="Region"
            description="Optional; defaults to the Lambda's region."
          >
            <Input
              placeholder="(default)"
              value={node.region ?? ""}
              onChange={({ detail }) =>
                onChange({
                  region: detail.value.trim() || undefined,
                } as Partial<DarNode>)
              }
            />
          </FormField>
        </>
      )}

      {node.kind === "httpCall" && (
        <>
          <FormField
            label="Method and URL"
            description="A single HTTP request, wrapped in a durable step. Use ${nodeName} in the URL to interpolate an upstream result."
          >
            <SpaceBetween size="xxs">
              <Select
                selectedOption={{
                  value: node.method,
                  label: node.method,
                }}
                options={HTTP_METHODS.map((m) => ({ value: m, label: m }))}
                onChange={({ detail }) =>
                  onChange({
                    method: detail.selectedOption.value,
                  } as Partial<DarNode>)
                }
              />
              <Input
                value={node.url}
                placeholder="https://api.example.com/v1/things"
                onChange={({ detail }) =>
                  onChange({ url: detail.value } as Partial<DarNode>)
                }
              />
            </SpaceBetween>
          </FormField>
          {node.operationId && (
            <Box variant="small" color="text-status-inactive">
              {node.specId ? `${node.specId} · ` : ""}
              {node.operationId}
            </Box>
          )}
          {/* Code-bearing nodes advertise their scope through the generated
              function signature; an API call has no signature, so the available
              names have to be listed explicitly or they're undiscoverable. */}
          {codeScope.length > 0 && (
            <Box fontSize="body-s" color="text-status-inactive">
              Available here:{" "}
              {codeScope.map((s, i) => (
                <span key={s}>
                  {i > 0 ? ", " : ""}
                  <code>{s}</code>
                </span>
              ))}
              . Use <code>{"${name}"}</code> in the URL, or <code>name</code>{" "}
              directly in query/headers/body.
            </Box>
          )}
          <FormField
            label="Authentication"
            description="The credential is read from a Lambda environment variable at run time. Never paste a key here — this workflow is saved to disk and shipped inside the deployment package."
          >
            <SpaceBetween size="xxs">
              <Select
                selectedOption={{
                  value: node.authKind ?? "none",
                  label: node.authKind ?? "none",
                }}
                options={HTTP_AUTH_KINDS.map((k) => ({ value: k, label: k }))}
                onChange={({ detail }) =>
                  onChange({
                    authKind: detail.selectedOption.value,
                  } as Partial<DarNode>)
                }
              />
              {(node.authKind ?? "none") !== "none" && (
                <Input
                  value={node.authEnvVar ?? ""}
                  placeholder="Env var NAME, e.g. STRIPE_API_KEY"
                  onChange={({ detail }) =>
                    onChange({
                      authEnvVar: detail.value.trim() || undefined,
                    } as Partial<DarNode>)
                  }
                />
              )}
              {(node.authKind === "header" || node.authKind === "query") && (
                <Input
                  value={node.authName ?? ""}
                  placeholder={
                    node.authKind === "header" ? "X-API-Key" : "api_key"
                  }
                  onChange={({ detail }) =>
                    onChange({
                      authName: detail.value.trim() || undefined,
                    } as Partial<DarNode>)
                  }
                />
              )}
            </SpaceBetween>
          </FormField>
          <CodeField
            label="Query parameters"
            description="A JS object of query-string values. Reference an upstream node by name, e.g. { customer: get_order.id }. Null/undefined values are omitted from the URL."
            value={node.query ?? ""}
            onEdit={() =>
              openEditor(
                `${node.id}::query`,
                node.query ?? "{\n}",
                "expression",
                "Edit query parameters",
              )
            }
          />
          <CodeField
            label="Headers"
            description="A JS object of extra request headers. content-type is set automatically when a body is sent."
            value={node.headers ?? ""}
            onEdit={() =>
              openEditor(
                `${node.id}::headers`,
                node.headers ?? "{\n}",
                "expression",
                "Edit headers",
              )
            }
          />
          {node.method !== "GET" && node.method !== "HEAD" && (
            <CodeField
              label="Request body"
              description="Prefilled from the API's OpenAPI schema. A JS object is JSON-encoded; a string is sent as-is."
              value={node.body ?? ""}
              onEdit={() =>
                openEditor(
                  `${node.id}::body`,
                  node.body ?? "{\n}",
                  "expression",
                  "Edit request body",
                )
              }
            />
          )}
          <FormField
            label="Timeout (seconds)"
            description="Optional; aborts the request. Blank = no client-side timeout."
          >
            <Input
              type="number"
              placeholder="(none)"
              value={
                node.timeoutSeconds === undefined
                  ? ""
                  : String(node.timeoutSeconds)
              }
              onChange={({ detail }) => {
                const n = Number(detail.value);
                onChange({
                  timeoutSeconds:
                    detail.value.trim() === "" || !Number.isFinite(n) || n <= 0
                      ? undefined
                      : n,
                } as Partial<DarNode>);
              }}
            />
          </FormField>
        </>
      )}

      {ERROR_SUPPORTED.has(node.kind) && (
        <ExpandableSection headerText="Error handling">
          <SpaceBetween size="s">
            <Box variant="small">
              On failure, match by error type and either route to a node (an
              error edge) or use a fallback value. No entries = the error
              propagates.
            </Box>
            {/* Routes — this node's "error"-kind outgoing edges. */}
            {edges
              .filter((e) => e.kind === "error" && e.source === node.id)
              .map((e) => (
                <div
                  key={e.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    border: "1px solid #30363d",
                    borderRadius: 6,
                    padding: 8,
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <Input
                        value={e.errorType ?? ""}
                        placeholder="ErrorType (blank = any)"
                        onChange={({ detail }) =>
                          onSetBranch(e.id, { errorType: detail.value })
                        }
                      />
                    </div>
                    <Select
                      selectedOption={{ value: "route", label: "Route to node" }}
                      options={[
                        { value: "route", label: "Route to node" },
                        { value: "fallback", label: "Fallback value" },
                      ]}
                      onChange={({ detail }) => {
                        if (detail.selectedOption.value === "fallback") {
                          // Convert the route into a node-owned fallback,
                          // keeping its error type.
                          onDeleteBranch(e.id);
                          onChange({
                            onError: [
                              ...(node.onError ?? []),
                              {
                                id: newId("eb"),
                                errorType: e.errorType ?? "",
                                fallbackCode: "",
                              },
                            ],
                          } as Partial<DarNode>);
                        }
                      }}
                    />
                    <Button
                      variant="icon"
                      iconName="close"
                      ariaLabel="Remove error route"
                      onClick={() => onDeleteBranch(e.id)}
                    />
                  </div>
                  <Select
                    selectedOption={(() => {
                      const tn = nodes.find((n) => n.id === e.target);
                      return tn
                        ? { value: e.target, label: tn.name || tn.kind }
                        : null;
                    })()}
                    placeholder="Choose a node…"
                    options={nodes
                      .filter((n) => n.id !== node.id && n.kind !== "start")
                      .map((n) => ({ value: n.id, label: n.name || n.kind }))}
                    onChange={({ detail }) =>
                      onSetBranch(e.id, {
                        target: detail.selectedOption.value as string,
                      })
                    }
                  />
                </div>
              ))}
            {/* Fallbacks — node-owned recovery values (no destination). */}
            {(node.onError ?? []).map((b) => {
              const updateBranch = (patch: Partial<ErrorBranch>) =>
                onChange({
                  onError: (node.onError ?? []).map((x) =>
                    x.id === b.id ? { ...x, ...patch } : x,
                  ),
                } as Partial<DarNode>);
              const firstTarget = nodes.find(
                (n) => n.id !== node.id && n.kind !== "start",
              );
              return (
                <div
                  key={b.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    border: "1px solid #30363d",
                    borderRadius: 6,
                    padding: 8,
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <Input
                        value={b.errorType ?? ""}
                        placeholder="ErrorType (blank = any)"
                        onChange={({ detail }) =>
                          updateBranch({ errorType: detail.value })
                        }
                      />
                    </div>
                    <Select
                      selectedOption={{
                        value: "fallback",
                        label: "Fallback value",
                      }}
                      options={[
                        { value: "route", label: "Route to node" },
                        { value: "fallback", label: "Fallback value" },
                      ]}
                      onChange={({ detail }) => {
                        if (
                          detail.selectedOption.value === "route" &&
                          firstTarget
                        ) {
                          // Convert the fallback into an error edge, keeping
                          // its error type.
                          onChange({
                            onError: (node.onError ?? []).filter(
                              (x) => x.id !== b.id,
                            ),
                          } as Partial<DarNode>);
                          onAddErrorRoute(
                            node.id,
                            firstTarget.id,
                            b.errorType ?? "",
                          );
                        }
                      }}
                    />
                    <Button
                      variant="icon"
                      iconName="close"
                      ariaLabel="Remove error branch"
                      onClick={() =>
                        onChange({
                          onError: (node.onError ?? []).filter(
                            (x) => x.id !== b.id,
                          ),
                        } as Partial<DarNode>)
                      }
                    />
                  </div>
                  <CodeField
                    label="Fallback value (TypeScript)"
                    description="Return the value to use as this node's result. `err` is in scope."
                    value={b.fallbackCode ?? ""}
                    onEdit={() =>
                      openEditor(
                        `${node.id}::onErrorFallback::${b.id}`,
                        b.fallbackCode ?? "",
                        "fallback",
                        "Edit fallback value",
                      )
                    }
                  />
                </div>
              );
            })}
            <Button
              iconName="add-plus"
              onClick={() => {
                const t = nodes.find(
                  (n) => n.id !== node.id && n.kind !== "start",
                );
                if (t) {
                  onAddErrorRoute(node.id, t.id, "");
                } else {
                  onChange({
                    onError: [
                      ...(node.onError ?? []),
                      { id: newId("eb"), errorType: "", fallbackCode: "" },
                    ],
                  } as Partial<DarNode>);
                }
              }}
            >
              Add error branch
            </Button>
          </SpaceBetween>
        </ExpandableSection>
      )}

      <Modal
        visible={agent !== null}
        onDismiss={() => setAgent(null)}
        header={`Generate ${agent?.label ?? "code"} with AI`}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setAgent(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={agentBusy}
                disabled={!agentDesc.trim()}
                onClick={runAgent}
              >
                Generate
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <FormField
            label="Describe what this code should do"
            description="The model writes TypeScript using the in-scope variables; review before deploying."
          >
            <Textarea
              value={agentDesc}
              onChange={({ detail }) => setAgentDesc(detail.value)}
              rows={4}
              placeholder="e.g. Look up the order by event.orderId and return its total price"
            />
          </FormField>
          {agentBusy && (
            <Box color="text-status-inactive">
              <Spinner /> Generating…
            </Box>
          )}
          {agentError && (
            <Alert type="error" header="Couldn't generate code">
              {agentError}
            </Alert>
          )}
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}

function DurationField({
  label,
  value,
  unit,
  onValue,
  onUnit,
}: {
  label: string;
  value: number;
  unit: DurationUnit;
  onValue: (v: number) => void;
  onUnit: (u: DurationUnit) => void;
}) {
  return (
    <FormField label={label}>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Input
            type="number"
            value={String(value)}
            onChange={({ detail }) => onValue(Number(detail.value) || 0)}
          />
        </div>
        <div style={{ flex: 1 }}>
          <Select
            selectedOption={unitOption(unit)}
            options={DURATION_UNITS.map(unitOption)}
            onChange={({ detail }) =>
              onUnit(detail.selectedOption.value as DurationUnit)
            }
          />
        </div>
      </div>
    </FormField>
  );
}
