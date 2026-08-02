/**
 * Live account lookups for the Workflow Studio "Jobs" resource pickers. Maps a
 * {@link ResourceKind} to the AWS SDK v3 call that enumerates it and returns
 * `{ label, value }` options. Failures (e.g. AccessDenied) propagate to the
 * caller, which surfaces them while still letting the user type a value by hand.
 */
import { GlueClient, ListJobsCommand } from "@aws-sdk/client-glue";
import {
  BatchClient,
  DescribeJobDefinitionsCommand,
  DescribeJobQueuesCommand,
} from "@aws-sdk/client-batch";
import {
  CodeBuildClient,
  ListProjectsCommand,
} from "@aws-sdk/client-codebuild";
import {
  SFNClient,
  ListStateMachinesCommand,
  DescribeStateMachineCommand,
} from "@aws-sdk/client-sfn";
import {
  ECSClient,
  ListClustersCommand,
  ListTaskDefinitionFamiliesCommand,
} from "@aws-sdk/client-ecs";
import type { AwsContext } from "./functions";

export interface ResourceOption {
  label: string;
  value: string;
}

/** Last path segment of an ARN (or the input if it isn't an ARN). */
function nameFromArn(arn: string): string {
  return arn.split(/[:/]/).pop() || arn;
}

/**
 * Lists the resources of `kind` in the configured account/region. Capped to a
 * reasonable number of options for a picker. Throws on API errors so the caller
 * can show the reason while keeping manual entry available.
 */
export async function listResources(
  ctx: AwsContext,
  kind: string,
): Promise<ResourceOption[]> {
  switch (kind) {
    case "glueJob": {
      const c = new GlueClient(ctx);
      const res = await c.send(new ListJobsCommand({ MaxResults: 200 }));
      return (res.JobNames ?? []).map((n) => ({ label: n, value: n }));
    }
    case "batchJobQueue": {
      const c = new BatchClient(ctx);
      const res = await c.send(
        new DescribeJobQueuesCommand({ maxResults: 100 }),
      );
      return (res.jobQueues ?? []).map((q) => ({
        label: q.jobQueueName ?? q.jobQueueArn ?? "",
        value: q.jobQueueName ?? q.jobQueueArn ?? "",
      }));
    }
    case "batchJobDefinition": {
      const c = new BatchClient(ctx);
      const res = await c.send(
        new DescribeJobDefinitionsCommand({
          status: "ACTIVE",
          maxResults: 100,
        }),
      );
      const seen = new Set<string>();
      const out: ResourceOption[] = [];
      for (const d of res.jobDefinitions ?? []) {
        const name = d.jobDefinitionName;
        if (name && !seen.has(name)) {
          seen.add(name);
          out.push({ label: name, value: name });
        }
      }
      return out;
    }
    case "codebuildProject": {
      const c = new CodeBuildClient(ctx);
      const res = await c.send(new ListProjectsCommand({}));
      return (res.projects ?? []).map((p) => ({ label: p, value: p }));
    }
    case "stateMachineArn": {
      const c = new SFNClient(ctx);
      const res = await c.send(
        new ListStateMachinesCommand({ maxResults: 200 }),
      );
      return (res.stateMachines ?? []).map((s) => ({
        label: s.name ?? s.stateMachineArn ?? "",
        value: s.stateMachineArn ?? "",
      }));
    }
    case "ecsCluster": {
      const c = new ECSClient(ctx);
      const res = await c.send(new ListClustersCommand({ maxResults: 100 }));
      return (res.clusterArns ?? []).map((a) => ({
        label: nameFromArn(a),
        value: a,
      }));
    }
    case "ecsTaskDefinition": {
      const c = new ECSClient(ctx);
      const res = await c.send(
        new ListTaskDefinitionFamiliesCommand({
          status: "ACTIVE",
          maxResults: 100,
        }),
      );
      return (res.families ?? []).map((f) => ({ label: f, value: f }));
    }
    default:
      return [];
  }
}

/**
 * Fetches a state machine's ASL definition (and metadata) for the "Import Step
 * Functions" flow. Returns the raw `definition` JSON string.
 */
export async function describeStateMachine(
  ctx: AwsContext,
  arn: string,
): Promise<{ name: string; definition: string; queryLanguage?: string }> {
  const c = new SFNClient(ctx);
  const res = await c.send(
    new DescribeStateMachineCommand({ stateMachineArn: arn }),
  );
  return {
    name: res.name ?? nameFromArn(arn),
    definition: res.definition ?? "",
    queryLanguage: res.type,
  };
}
