/**
 * Minimal CloudFormation deploy wrapper for Step Functions starter packs'
 * infra templates (see `../starterPacks/assets/*.cfn.yaml.ts`). Deliberately
 * narrow: create a stack, wait for it, read its outputs, delete it. No
 * update/drift handling - a starter pack's infra stack is meant to be
 * deployed once per POC/demo and torn down, not maintained long-term (the
 * durable-Lambda workflow itself, once imported, is deployed/updated via the
 * existing `deployWorkflow()` in `../deploy.ts` - unrelated to this file).
 */
import {
  CloudFormationClient,
  DescribeStackResourcesCommand,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStackEventsCommand,
  DescribeStacksCommand,
  waitUntilStackDeleteComplete,
  type StackResource,
} from "@aws-sdk/client-cloudformation";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";

export interface CfnDeployOptions {
  region: string;
  credentials: AwsCredentialIdentityProvider;
}

export interface CfnStackResult {
  stackId: string;
  status: string;
  /** CloudFormation Outputs, keyed by output name. */
  outputs: Record<string, string>;
}

/** Per-resource progress snapshot, reported while a stack is being created. */
export interface CfnProgress {
  /** Resources that have reached a `_COMPLETE` status. */
  completed: number;
  /** Total resources declared in the template. */
  total: number;
  /** The resource CloudFormation is currently working on, if any. */
  currentResource?: string;
}

const TERMINAL_STATUSES = new Set([
  "CREATE_COMPLETE",
  "CREATE_FAILED",
  "ROLLBACK_COMPLETE",
  "ROLLBACK_FAILED",
  "DELETE_COMPLETE",
  "DELETE_FAILED",
]);

/** Resolves after `ms`, or immediately if `signal` aborts first. */
function sleepOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((r) => setTimeout(r, ms));
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Counts top-level resources declared in a CFN template (YAML or JSON) via a
 * plain string scan (one `Type:` line per resource block) rather than a full
 * YAML parser, since these templates are our own authored assets (see
 * `../starterPacks/assets/*.cfn.yaml.ts`), not arbitrary user input. Used
 * only to size the progress bar.
 */
export function countTemplateResources(templateBody: string): number {
  const matches = templateBody.match(/^\s*Type:\s*['"]?AWS::/gm) ?? [];
  return matches.length;
}

/** Creates a stack from a template body string. Returns its stack ID. */
export async function createStack(
  opts: CfnDeployOptions,
  templateBody: string,
  stackName: string,
): Promise<string> {
  const cfn = new CloudFormationClient({
    region: opts.region,
    credentials: opts.credentials,
  });
  const res = await cfn.send(
    new CreateStackCommand({
      StackName: stackName,
      TemplateBody: templateBody,
      Capabilities: ["CAPABILITY_IAM"],
      OnFailure: "DELETE",
    }),
  );
  if (!res.StackId) throw new Error("CreateStack did not return a StackId.");
  return res.StackId;
}

/** Fetches the stack's StackEvents reasons, for diagnosing a failed deploy. */
async function describeFailureReasons(
  cfn: CloudFormationClient,
  stackId: string,
): Promise<string[]> {
  try {
    const events = await cfn.send(
      new DescribeStackEventsCommand({ StackName: stackId }),
    );
    return (events.StackEvents ?? [])
      .filter((e) => e.ResourceStatus?.includes("FAILED"))
      .map(
        (e) =>
          `${e.LogicalResourceId ?? "?"}: ${e.ResourceStatusReason ?? e.ResourceStatus ?? "unknown"}`,
      );
  } catch {
    return [];
  }
}

/** Thrown when a deploy is cancelled via the `signal` passed to `waitForStackComplete`. */
export class CfnDeployCancelledError extends Error {
  constructor() {
    super("Deployment cancelled.");
    this.name = "CfnDeployCancelledError";
  }
}

/**
 * Waits for a stack to reach CREATE_COMPLETE, polling `DescribeStackResources`
 * every few seconds and reporting completed/total resource counts via
 * `onProgress` (e.g. for a progress bar) instead of the opaque all-or-nothing
 * `waitUntilStackCreateComplete` waiter. Throws with the stack's failure-event
 * reasons (not just "failed") if it rolls back instead.
 *
 * If `signal` is aborted while waiting, deletes the stack (best-effort - a
 * stack this early in creation is usually just rolled back/removed quickly)
 * and throws {@link CfnDeployCancelledError} rather than leaving it orphaned.
 */
export async function waitForStackComplete(
  opts: CfnDeployOptions,
  stackId: string,
  totalResources: number,
  onProgress?: (progress: CfnProgress) => void,
  signal?: AbortSignal,
): Promise<CfnStackResult> {
  const cfn = new CloudFormationClient({
    region: opts.region,
    credentials: opts.credentials,
  });

  const maxWaitMs = 300_000;
  const pollIntervalMs = 5_000;
  const deadline = Date.now() + maxWaitMs;

  let finalStatus: string | undefined;
  for (;;) {
    if (signal?.aborted) {
      try {
        await cfn.send(new DeleteStackCommand({ StackName: stackId }));
      } catch {
        // Best-effort - if this fails, the stack still shows up in the
        // console/CLI for manual cleanup; not silently lost.
      }
      throw new CfnDeployCancelledError();
    }

    const [described, resources] = await Promise.all([
      cfn.send(new DescribeStacksCommand({ StackName: stackId })),
      cfn
        .send(new DescribeStackResourcesCommand({ StackName: stackId }))
        .catch(() => ({ StackResources: [] as StackResource[] })),
    ]);

    const stack = described.Stacks?.[0];
    const status = stack?.StackStatus ?? "UNKNOWN";
    const resourceList = resources.StackResources ?? [];
    const completed = resourceList.filter((r) =>
      r.ResourceStatus?.endsWith("_COMPLETE"),
    ).length;
    const inProgress = resourceList.find((r) =>
      r.ResourceStatus?.endsWith("_IN_PROGRESS"),
    );
    onProgress?.({
      completed,
      total: totalResources,
      currentResource: inProgress?.LogicalResourceId,
    });

    if (status && TERMINAL_STATUSES.has(status)) {
      finalStatus = status;
      break;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Stack ${stackId} did not reach CREATE_COMPLETE within ${maxWaitMs / 1000}s (last status: ${status}).`,
      );
    }
    await sleepOrAbort(pollIntervalMs, signal);
  }

  if (finalStatus !== "CREATE_COMPLETE") {
    const reasons = await describeFailureReasons(cfn, stackId);
    throw new Error(
      `Stack ${stackId} ended in ${finalStatus}, not CREATE_COMPLETE.` +
        (reasons.length ? `\nFailure reasons:\n${reasons.join("\n")}` : ""),
    );
  }

  const described = await cfn.send(
    new DescribeStacksCommand({ StackName: stackId }),
  );
  const stack = described.Stacks?.[0];
  if (!stack) throw new Error(`Stack ${stackId} not found after create.`);

  const outputs: Record<string, string> = {};
  for (const o of stack.Outputs ?? []) {
    if (o.OutputKey && o.OutputValue) outputs[o.OutputKey] = o.OutputValue;
  }
  return { stackId, status: stack.StackStatus ?? "UNKNOWN", outputs };
}

/** Deletes a stack and waits for DELETE_COMPLETE. */
export async function deleteStack(
  opts: CfnDeployOptions,
  stackId: string,
): Promise<void> {
  const cfn = new CloudFormationClient({
    region: opts.region,
    credentials: opts.credentials,
  });
  await cfn.send(new DeleteStackCommand({ StackName: stackId }));
  await waitUntilStackDeleteComplete(
    { client: cfn, maxWaitTime: 300 },
    { StackName: stackId },
  );
}
