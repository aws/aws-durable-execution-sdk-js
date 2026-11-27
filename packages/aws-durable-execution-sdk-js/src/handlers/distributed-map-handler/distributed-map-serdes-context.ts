import type { SerdesContext } from "../../utils/serdes/serdes";
import { parseDurableExecutionArn } from "../../utils/serdes/filesystem-serdes";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

const RUN_ARN_SEPARATOR = "/distributed-map-run/";

/**
 * The parts of a distributed map run ARN.
 * @internal
 */
export interface DistributedMapRunArnParts {
  /** The ARN of the durable execution that started the run. */
  parentExecutionArn: string;
  runId: string;
}

/**
 * Splits a run ARN into the parent execution ARN and the run id.
 * Returns undefined when the ARN does not have that form.
 * @internal
 */
export function parseDistributedMapRunArn(
  runArn: unknown,
): DistributedMapRunArnParts | undefined {
  if (typeof runArn !== "string") return undefined;
  // A run id contains no "/". So the separator is its last occurrence.
  const index = runArn.lastIndexOf(RUN_ARN_SEPARATOR);
  if (index <= 0) return undefined;
  const runId = runArn.slice(index + RUN_ARN_SEPARATOR.length);
  if (runId === "" || runId.includes("/")) return undefined;
  const parentExecutionArn = runArn.slice(0, index);
  if (!parseDurableExecutionArn(parentExecutionArn)) return undefined;
  return { parentExecutionArn, runId };
}

/**
 * Builds a distinct serdes context for one value of a distributed map run.
 * The role and parts name the value within the run.
 * Throws when the run ARN does not parse. Callers validate the ARN first.
 * @internal
 */
export function dmapSerdesContext(
  runArn: string,
  role: string,
  ...parts: unknown[]
): SerdesContext {
  const run = parseDistributedMapRunArn(runArn);
  if (!run) {
    throw new Error(`invalid distributed map run ARN: ${runArn}`);
  }
  return {
    entityId: hashId(JSON.stringify([run.runId, role, ...parts])),
    // The parent execution ARN, because this field holds an execution ARN.
    durableExecutionArn: run.parentExecutionArn,
  };
}
