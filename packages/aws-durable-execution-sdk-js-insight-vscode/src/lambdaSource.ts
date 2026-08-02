/**
 * Fetches a Lambda function's handler source so the Step Functions importer can
 * optionally INLINE a `lambda:invoke` Task as a durable `step` (instead of
 * preserving a cross-function `chainInvoke`). This is opt-in and best-effort:
 * only self-contained Node.js handlers are eligible, and anything ineligible
 * falls back to `chainInvoke` (the caller decides).
 *
 * Inlining folds the Lambda's logic into the durable function; its environment
 * (IAM role, env vars, layers, VPC, memory/timeout) does NOT come along, so the
 * importer surfaces a note for every inlined task.
 */
import AdmZip from "adm-zip";
import { LambdaClient, GetFunctionCommand } from "@aws-sdk/client-lambda";
import type { AwsContext } from "./functions";
import type { AslState, AslStateMachine } from "./aslSkeleton";

/** The inlinable source of one Lambda handler. */
export interface LambdaSource {
  handler: string;
  source: string;
}

/** Max handler source size we will attempt to inline (bytes). */
const MAX_SOURCE_BYTES = 60_000;

/**
 * The concrete function name/ARN a `lambda:invoke` Task targets, or null if it
 * is dynamic (`FunctionName.$`) or not a Lambda task we can resolve.
 */
export function functionRefForState(state: AslState): string | null {
  const r = state.Resource ?? "";
  const isLambda =
    r.includes("states:::lambda:invoke") || r.startsWith("arn:aws:lambda:");
  if (!isLambda) return null;
  const params = state.Parameters ?? {};
  const name = params.FunctionName;
  if (typeof name === "string" && name.trim()) return name;
  // `FunctionName.$` (a JSONPath) means the target is chosen at runtime.
  if ("FunctionName.$" in params) return null;
  if (r.startsWith("arn:aws:lambda:")) return r;
  return null;
}

/** Recursively collect every lambda:invoke Task's state name → function ref. */
export function collectLambdaStates(
  machine: AslStateMachine,
): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (m: AslStateMachine) => {
    for (const [name, st] of Object.entries(m.States ?? {})) {
      const ref = functionRefForState(st);
      if (ref && !out.has(name)) out.set(name, ref);
      for (const b of st.Branches ?? []) walk(b);
      if (st.ItemProcessor) walk(st.ItemProcessor);
      if (st.Iterator) walk(st.Iterator);
    }
  };
  walk(machine);
  return out;
}

/** Candidate handler filenames for an ASL/Lambda `handler` string. */
function handlerFileCandidates(handler: string): string[] {
  const base = handler.slice(0, handler.lastIndexOf(".")) || handler;
  return [".js", ".mjs", ".cjs", ".ts"].map((ext) => `${base}${ext}`);
}

/**
 * Downloads a function's deployment package and extracts its handler source if
 * the function is an eligible, self-contained Node.js handler. Returns the
 * source (when eligible) plus a human reason when it is not.
 */
export async function fetchLambdaSource(
  ctx: AwsContext,
  functionRef: string,
): Promise<{
  eligible: boolean;
  reason?: string;
  handler?: string;
  source?: string;
  runtime?: string;
}> {
  const lambda = new LambdaClient(ctx);
  const res = await lambda.send(
    new GetFunctionCommand({ FunctionName: functionRef }),
  );
  const cfg = res.Configuration;
  const runtime = cfg?.Runtime;
  if (!runtime || !runtime.startsWith("nodejs"))
    return {
      eligible: false,
      runtime,
      reason: `runtime ${runtime ?? "unknown"} cannot be inlined (Node.js only)`,
    };
  if ((cfg?.Layers ?? []).length > 0)
    return { eligible: false, runtime, reason: "function uses Lambda layers" };

  const url = res.Code?.Location;
  if (!url)
    return { eligible: false, runtime, reason: "no downloadable code package" };

  let buf: Buffer;
  try {
    const dl = await fetch(url);
    if (!dl.ok) throw new Error(`HTTP ${dl.status}`);
    buf = Buffer.from(await dl.arrayBuffer());
  } catch (e) {
    return {
      eligible: false,
      runtime,
      reason: `could not download code: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  let entries: AdmZip.IZipEntry[];
  try {
    entries = new AdmZip(buf).getEntries();
  } catch (e) {
    return {
      eligible: false,
      runtime,
      reason: `could not read code package: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const handler = cfg?.Handler ?? "index.handler";
  const candidates = handlerFileCandidates(handler);
  const entry = entries.find((en) => candidates.includes(en.entryName));
  if (!entry)
    return {
      eligible: false,
      runtime,
      reason: `handler file for "${handler}" not found in the package`,
    };

  const source = entry.getData().toString("utf-8");
  if (source.length > MAX_SOURCE_BYTES)
    return {
      eligible: false,
      runtime,
      reason: `handler source is large (${source.length} bytes); left as an invoke`,
    };

  return { eligible: true, runtime, handler, source };
}

/**
 * Resolves inlinable sources for every lambda:invoke Task in the machine.
 * Returns a map (state name → source) of the eligible ones, plus notes
 * describing any that were skipped (kept as `chainInvoke`).
 */
export async function resolveInlineSources(
  ctx: AwsContext,
  machine: AslStateMachine,
): Promise<{ sources: Map<string, LambdaSource>; notes: string[] }> {
  const refs = collectLambdaStates(machine);
  const sources = new Map<string, LambdaSource>();
  const notes: string[] = [];
  for (const [stateName, ref] of refs) {
    try {
      const r = await fetchLambdaSource(ctx, ref);
      if (r.eligible && r.source && r.handler) {
        sources.set(stateName, { handler: r.handler, source: r.source });
      } else {
        notes.push(`"${stateName}" kept as an invoke — ${r.reason}.`);
      }
    } catch (e) {
      notes.push(
        `"${stateName}" kept as an invoke — could not inspect the function: ${e instanceof Error ? e.message : String(e)}.`,
      );
    }
  }
  return { sources, notes };
}
