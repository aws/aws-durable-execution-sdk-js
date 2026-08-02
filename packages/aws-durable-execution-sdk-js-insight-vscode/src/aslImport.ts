/**
 * Import an AWS Step Functions state machine (Amazon States Language / ASL) and
 * convert it to the Workflow Studio `.dar` model.
 *
 * Strategy is HYBRID:
 *  - Pass 1 — {@link aslToSkeleton} (in `aslSkeleton.ts`) deterministically maps
 *    the ASL state graph to a structurally-valid `.dar` whose code bodies are
 *    compilable stubs. No LLM; the reliable, unit-tested part.
 *  - Pass 2 — the agent fills each node's code body by translating that state's
 *    `Resource`/`Parameters`/`ResultSelector`/JSONata/JSONPath into TypeScript.
 *  - A dual-gate refine loop then accepts the result only when it is BOTH
 *    mechanically valid (`validateDarJson` → 0 errors) AND judged a faithful
 *    representation of the source ASL, stopping the instant both pass or the
 *    iteration budget is exhausted.
 */
import {
  type AgentLlmOptions,
  generateNodeCode,
  stripFences,
  validateDarJson,
} from "./agent";
import type { AwsContext } from "./functions";
import { resolveInlineSources } from "./lambdaSource";
import { completeText } from "./llm";
import { describeStateMachine } from "./resources";
import { parseVerdict } from "./verdict";
import {
  aslToSkeleton,
  type AslStateMachine,
  type DarLikeWorkflow,
} from "./aslSkeleton";

/** A progress event emitted during conversion (for a status line / log). */
export interface ImportEvent {
  phase: "skeleton" | "code" | "validate" | "judge" | "done";
  detail: string;
}

export interface ImportResult {
  /** The converted `.dar` JSON text (validated), ready to load. */
  dar: string;
  notes: string[];
  iterations: number;
  /** Whether the faithfulness judge accepted the final result. */
  faithful: boolean;
}

/** Set a node's field in the workflow object (searches nested bodies too). */
function setNodeField(
  wf: DarLikeWorkflow,
  nodeId: string,
  field: string,
  value: string,
): void {
  const visit = (w: DarLikeWorkflow): boolean => {
    for (const n of w.nodes) {
      if (n.id === nodeId) {
        n[field] = value;
        return true;
      }
      const branches = n.branches as { body: DarLikeWorkflow }[] | undefined;
      if (branches) for (const b of branches) if (visit(b.body)) return true;
      const body = n.body as DarLikeWorkflow | undefined;
      if (body && visit(body)) return true;
    }
    return false;
  };
  visit(wf);
}

function buildFaithfulnessPrompt(aslDefinition: string, dar: string): string {
  return [
    "You are reviewing an automatic conversion of an AWS Step Functions state",
    "machine (Amazon States Language) into a durable-execution workflow (.dar).",
    "Decide whether the .dar FAITHFULLY represents the ASL: same states/steps,",
    "same control flow (choices, parallel, map, catch), and equivalent per-state",
    "logic. Minor naming/layout differences are fine.",
    "",
    "Respond with ONLY a JSON object:",
    '{ "satisfied": boolean, "reason": string, "suggestion"?: string }',
    'where "suggestion" (when not satisfied) is a concrete fix for the .dar.',
    "",
    "=== SOURCE ASL ===",
    aslDefinition,
    "",
    "=== CONVERTED .dar ===",
    dar,
  ].join("\n");
}

/**
 * Convert an ASL definition string to a validated `.dar`. Runs Pass 1 + Pass 2,
 * then a dual-gate (validity + faithfulness) refine loop bounded by
 * `maxIterations`.
 */
export async function convertStateMachine(
  opts: AgentLlmOptions,
  definition: string,
  maxIterations: number,
  onEvent: (e: ImportEvent) => void = () => {},
  inline?: {
    sources?: Map<string, { handler: string; source: string }>;
    notes?: string[];
  },
): Promise<ImportResult> {
  let machine: AslStateMachine;
  try {
    machine = JSON.parse(definition) as AslStateMachine;
  } catch (e) {
    throw new Error(
      `The state machine definition is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!machine.States || typeof machine.States !== "object") {
    throw new Error("Not an ASL state machine: missing a `States` object.");
  }

  onEvent({ phase: "skeleton", detail: "Mapping ASL states to nodes…" });
  const skeleton = aslToSkeleton(machine, { inlineSources: inline?.sources });
  const { workflow, todos } = skeleton;
  const notes = [...(inline?.notes ?? []), ...skeleton.notes];

  // Pass 2: fill each node's code body (best-effort; stubs remain on failure).
  for (const todo of todos) {
    onEvent({ phase: "code", detail: `Writing code for "${todo.name}"…` });
    try {
      const code = await generateNodeCode(opts, {
        kind: todo.kind,
        field: todo.field,
        name: todo.name,
        description: todo.description,
        scope: [],
      });
      setNodeField(workflow, todo.nodeId, todo.field, code);
    } catch {
      notes.push(
        `Could not auto-generate code for "${todo.name}"; left a stub.`,
      );
    }
  }

  // Dual-gate refine loop.
  let current = JSON.stringify(workflow, null, 2);
  let faithful = false;
  let iterations = 0;
  const budget = Math.max(1, maxIterations);

  for (let i = 0; i < budget; i += 1) {
    iterations = i + 1;
    onEvent({
      phase: "validate",
      detail: `Validating (attempt ${iterations})…`,
    });
    const { workflow: normalized, errors } = await validateDarJson(current);

    if (errors.length > 0) {
      const repairPrompt = [
        "Fix this Workflow Studio .dar JSON so it is valid. Return ONLY the",
        "corrected, complete JSON object — no prose, no fences.",
        "",
        "Problems:",
        ...errors.map((e) => `- ${e}`),
        "",
        "Current .dar:",
        current,
      ].join("\n");
      current = stripFences(await completeText(opts, repairPrompt, 4096));
      continue;
    }

    const valid = normalized ?? current;
    onEvent({ phase: "judge", detail: "Checking faithfulness to the ASL…" });
    const verdict = parseVerdict(
      await completeText(
        opts,
        buildFaithfulnessPrompt(definition, valid),
        1024,
      ),
    );
    if (verdict.satisfied) {
      onEvent({ phase: "done", detail: "Conversion complete." });
      return { dar: valid, notes, iterations, faithful: true };
    }
    faithful = false;
    if (i === budget - 1) {
      notes.push(
        `Faithfulness not confirmed after ${iterations} iterations: ${verdict.reason}`,
      );
      onEvent({ phase: "done", detail: "Done (faithfulness unconfirmed)." });
      return { dar: valid, notes, iterations, faithful: false };
    }
    const refinePrompt = [
      "This .dar is valid but does not yet faithfully represent the source ASL.",
      `Reviewer feedback: ${verdict.reason}`,
      verdict.suggestion ? `Suggested fix: ${verdict.suggestion}` : "",
      "Return ONLY a corrected, complete .dar JSON object.",
      "",
      "=== SOURCE ASL ===",
      definition,
      "",
      "=== CURRENT .dar ===",
      valid,
    ]
      .filter(Boolean)
      .join("\n");
    current = stripFences(await completeText(opts, refinePrompt, 4096));
  }

  const { workflow: last, errors } = await validateDarJson(current);
  if (last && errors.length === 0)
    return { dar: last, notes, iterations, faithful };
  throw new Error(
    `Couldn't produce a valid workflow from the state machine after ${iterations} iterations:\n` +
      errors.map((e) => `- ${e}`).join("\n"),
  );
}

export interface ImportStateMachineOptions {
  ctx: AwsContext;
  arn: string;
  llmOptions: AgentLlmOptions;
  maxIterations: number;
  /**
   * Opt-in: fetch eligible Node.js Lambda handler sources so those
   * `lambda:invoke` tasks can be inlined as steps (best-effort; ineligible
   * ones stay invokes).
   */
  inlineLambdas: boolean;
  onEvent?: (e: ImportEvent) => void;
}

/**
 * Fetches a state machine's ASL definition, optionally resolves inlinable
 * Lambda sources, and converts it to a validated `.dar` via
 * {@link convertStateMachine}. This is the full "Import Step Functions" flow
 * minus the UI/message-protocol concerns (posting progress/result messages),
 * which the caller handles via `onEvent` and the returned {@link ImportResult}.
 */
export async function importStateMachineFromArn(
  opts: ImportStateMachineOptions,
): Promise<ImportResult> {
  const { ctx, arn, llmOptions, maxIterations, inlineLambdas } = opts;
  const onEvent = opts.onEvent ?? (() => {});

  const { definition } = await describeStateMachine(ctx, arn);
  if (!definition.trim())
    throw new Error("The state machine has no readable definition.");

  // Opt-in: fetch eligible Node.js Lambda handler sources so those tasks
  // can be inlined as steps (best-effort; ineligible ones stay invokes).
  let inline:
    | {
        sources: Map<string, { handler: string; source: string }>;
        notes: string[];
      }
    | undefined;
  if (inlineLambdas) {
    onEvent({
      phase: "skeleton",
      detail: "Fetching Lambda sources to inline…",
    });
    try {
      inline = await resolveInlineSources(ctx, JSON.parse(definition));
    } catch (e) {
      inline = {
        sources: new Map(),
        notes: [
          `Could not inspect Lambda sources; kept invokes: ${e instanceof Error ? e.message : String(e)}`,
        ],
      };
    }
  }

  return convertStateMachine(
    llmOptions,
    definition,
    maxIterations,
    onEvent,
    inline,
  );
}
