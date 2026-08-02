import type { DarWorkflow } from "./darModel";

/**
 * Filename of the full `.dar` workflow embedded in a deployed durable
 * Lambda's deployment package, in the legacy JSON `.dar` format. Superseded
 * by {@link WORKFLOW_DAR_TS_FILENAME} as of dar-ts-specification.md's Phase
 * 2 ("`.dar.ts` becomes... the embedded deploy artifact") — kept only so
 * functions deployed BEFORE this change still open correctly (see
 * `functions.ts`'s `getWorkflowDar`, which checks both filenames).
 */
export const WORKFLOW_DAR_FILENAME = "workflow.dar.json";

/**
 * Filename of the full workflow embedded in a deployed durable Lambda's
 * deployment package, in the `.dar.ts` format (see
 * `docs/dar-ts-specification.md`) — the CURRENT embed format as of Phase 2.
 * `.dar.ts` is authored/edited directly by users and preserves real
 * multi-line code (each node's `code`/`submitterCode` is a genuine
 * standalone function, not a JSON-escaped single-line string), so re-editing
 * a downloaded workflow, and mapping a debugger breakpoint back to a real
 * source line, both work at STATEMENT granularity instead of the JSON
 * format's whole-node granularity.
 */
export const WORKFLOW_DAR_TS_FILENAME = "workflow.dar.ts";

/**
 * Lambda tag key set on functions that embed a {@link WORKFLOW_DAR_TS_FILENAME}
 * (or, for functions deployed before this change, {@link WORKFLOW_DAR_FILENAME}).
 * Its presence tells a reader it is worth downloading the code package to read
 * the workflow — functions created another way lack the tag and are skipped.
 */
export const WORKFLOW_DAR_TAG_KEY = "workflowStudioDar";
export const WORKFLOW_DAR_TAG_VALUE = "1";

/**
 * Serializes the workflow intact (code included) as pretty JSON.
 *
 * NOTE ON WHICH FORMAT IS ACTUALLY EMBEDDED. The VS Code / desktop deploy path
 * writes {@link WORKFLOW_DAR_TS_FILENAME}, which is the intended format. The
 * `DurableWorkflowFunction` CDK construct still writes THIS JSON form, because the
 * `.dar.ts` serializer currently lives in the extension package rather than in a
 * package `-cdk` can import. The consequence for a construct-deployed function is
 * real but bounded: it reopens in Studio at whole-node granularity instead of
 * statement granularity, and it ships no source map, since the construct also does
 * not call `generateHandlerWithMap`.
 *
 * This comment previously claimed JSON was "no longer written into new deployment
 * packages", which was false for every construct user. Moving the serializer into
 * `visual-workflow-model` and wiring the source map into the construct is tracked
 * as a follow-up; it is a refactor across packages, not a doc fix.
 */
export function serializeWorkflow(workflow: DarWorkflow): string {
  return JSON.stringify(workflow, null, 2);
}
