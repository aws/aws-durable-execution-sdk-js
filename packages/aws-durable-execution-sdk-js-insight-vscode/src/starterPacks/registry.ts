/**
 * Pack-agnostic registry for the Step Functions starter packs vendored under
 * `./assets/*.cfn.yaml.ts` + `./assets/*.dar.template.ts`. Each pack pairs a
 * CFN infra template with a `.dar` template resolver
 * (`resolve<Pack>Dar(ctx)`), whose `<Pack>DarContext` field names differ per
 * pack (they mirror each pack's own CFN Outputs — see the per-pack mapping
 * functions below). This module is the single place that:
 *
 *  1. Declares the closed set of pack ids (`StarterPackId`) and their
 *     display metadata (`STARTER_PACKS`) — consumed by the extension host
 *     dispatch below AND (duplicated, see
 *     `webview-ui/src/studio/StarterPackPickerModal.tsx`) by the picker UI.
 *  2. Implements `deployStarterPackInfra`, the ONE generic
 *     create-stack/wait/resolve-dar orchestration (moved here from the old
 *     HelloLambda-only `deployStarterPack.ts`), parameterized per pack only
 *     by (a) which CFN template to deploy and (b) how to map that pack's CFN
 *     Outputs onto its `resolve<Pack>Dar` context.
 */
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import {
  createStack,
  waitForStackComplete,
  countTemplateResources,
  type CfnProgress,
} from "./cfnDeploy";
import helloLambdaCfnTemplate from "./assets/helloLambda.cfn.yaml";
import { resolveHelloLambdaDar } from "./assets/helloLambda.dar.template";
import taskTimerCfnTemplate from "./assets/taskTimer.cfn.yaml";
import { resolveTaskTimerDar } from "./assets/taskTimer.dar.template";
import waitForCallbackCfnTemplate from "./assets/waitForCallback.cfn.yaml";
import { resolveWaitForCallbackDar } from "./assets/waitForCallback.dar.template";
import jobStatusPollerCfnTemplate from "./assets/jobStatusPoller.cfn.yaml";
import { resolveJobStatusPollerDar } from "./assets/jobStatusPoller.dar.template";
import dynamicParallelProcessingCfnTemplate from "./assets/dynamicParallelProcessing.cfn.yaml";
import { resolveDynamicParallelProcessingDar } from "./assets/dynamicParallelProcessing.dar.template";
import eventBridgeCustomEventCfnTemplate from "./assets/eventBridgeCustomEvent.cfn.yaml";
import { resolveEventBridgeCustomEventDar } from "./assets/eventBridgeCustomEvent.dar.template";
import { resolveBedrockPromptChainingDar } from "./assets/bedrockPromptChaining.dar.template";

/**
 * Starter pack id; literal union so adding a pack is a small, exhaustively
 * checked extension (kept in sync with the webview's own copy — see
 * `webview-ui/src/types.ts` and `webview-ui/src/studio/StarterPackPickerModal.tsx`).
 *
 * NestedWorkflow ("nwf") and DistributedMapCSVIterator are deliberately NOT
 * included here even though both are vendored and verified under
 * `assets/` — see the "packs deliberately excluded from the picker" note
 * below `STARTER_PACKS` for why.
 */
export type StarterPackId =
  | "hl"
  | "tt"
  | "cbt"
  | "jsp"
  | "dpp"
  | "ebce"
  | "bpc";

/** Display metadata for one starter pack, shown in the picker UI. */
export interface StarterPackMetadata {
  id: StarterPackId;
  title: string;
  description: string;
  /** A Cloudscape built-in icon name (see `@cloudscape-design/components/icon-provider`'s `BuiltInIconName`). */
  icon: string;
  /** Short bullets of the real AWS resources the pack's CFN stack creates. Empty for a pack with no supporting infra (see `hasInfra`). */
  resourceSummary: string[];
  /**
   * Whether this pack creates a CloudFormation stack at all. False for packs
   * whose only "deployment" is the durable Lambda itself (no supporting AWS
   * resources) — the picker UI uses this to avoid claiming a stack was
   * created when none was (see `bpc`/BedrockPromptChaining).
   */
  hasInfra: boolean;
  /**
   * True when the pack's workflow uses `dag` dependency mode, which cannot be
   * deployed yet: codegen emits `context.dag(...)` and the dag task builders,
   * and the runtime SDK does not implement them — a deployed function fails at
   * invoke time with "context.dag is not a function".
   *
   * These packs are hidden from the picker unless dag mode is explicitly
   * enabled, so a user cannot choose one and get an undeployable workflow.
   * Remove this flag (and the filter) once the dag runtime lands.
   */
  requiresDagRuntime?: boolean;
}

/**
 * Metadata for all 7 vendored-and-registered packs. `resourceSummary` is
 * derived directly from each pack's `assets/<pack>.cfn.yaml.ts` `Resources:`
 * block — see that file for the authoritative resource list.
 */
export const STARTER_PACKS: Record<StarterPackId, StarterPackMetadata> = {
  hl: {
    id: "hl",
    title: "Human Approval Workflow",
    description:
      "Checks a stock price, waits for a human to approve a buy/sell recommendation via a callback, then executes the trade and reports the result.",
    icon: "gen-ai",
    resourceSummary: ["5 Lambda functions", "1 SQS queue", "1 SNS topic"],
    hasInfra: true,
  },
  tt: {
    id: "tt",
    title: "Task Timer",
    description:
      "Waits for a configurable duration, then publishes a notification to an SNS topic. The simplest possible wait-then-notify pattern.",
    icon: "calendar",
    resourceSummary: ["1 SNS topic"],
    hasInfra: true,
  },
  cbt: {
    id: "cbt",
    title: "Wait for Callback",
    description:
      "Starts a task, waits for an external system to send a callback via SQS, and notifies success or failure over SNS depending on the outcome.",
    icon: "envelope",
    resourceSummary: [
      "1 Lambda function",
      "1 SQS queue + 1 dead-letter queue",
      "1 SNS topic",
    ],
    hasInfra: true,
  },
  jsp: {
    id: "jsp",
    title: "Job Status Poller",
    description:
      "Submits an AWS Batch job and polls its status until it succeeds or fails. The heaviest pack — provisions a full VPC and AWS Batch compute environment (real EC2 compute), so it takes longer to deploy and tear down than the others.",
    icon: "refresh",
    resourceSummary: [
      "2 Lambda functions",
      "1 AWS Batch job queue + compute environment (VPC, EC2)",
    ],
    hasInfra: true,
    // Uses dag dependency mode, which has no runtime yet — hidden from the
    // picker unless enableDagMode is set, so it can't be chosen and then fail
    // at invoke time with "context.dag is not a function".
    requiresDagRuntime: true,
  },
  dpp: {
    id: "dpp",
    title: "Dynamic Parallel Processing",
    description:
      "Reads messages from an SQS queue and fans out to process each one in parallel — writing to DynamoDB, deleting the message, and publishing a notification per message.",
    icon: "share",
    resourceSummary: [
      "1 SQS queue",
      "1 DynamoDB table",
      "1 SNS topic (KMS-encrypted)",
    ],
    hasInfra: true,
    // Uses dag dependency mode, which has no runtime yet — hidden from the
    // picker unless enableDagMode is set, so it can't be chosen and then fail
    // at invoke time with "context.dag is not a function".
    requiresDagRuntime: true,
  },
  ebce: {
    id: "ebce",
    title: "EventBridge Custom Event",
    description:
      "Publishes a custom event to Amazon EventBridge, which fans out to a Lambda function, an SNS topic, and an SQS queue via an EventBridge Rule.",
    icon: "share",
    resourceSummary: [
      "1 EventBridge event bus + rule",
      "1 Lambda function",
      "1 SQS queue",
      "1 SNS topic (KMS-encrypted)",
    ],
    hasInfra: true,
  },
  bpc: {
    id: "bpc",
    title: "Bedrock Prompt Chaining",
    description:
      "Chains a sequence of prompts to an Amazon Bedrock foundation model, feeding each response into the next prompt to build a connected conversation.",
    icon: "gen-ai",
    resourceSummary: [],
    hasInfra: false,
  },
};

/**
 * Packs that are vendored and verified (see `assets/`) but deliberately NOT
 * included in `STARTER_PACKS`/the picker UI yet:
 *
 *  - `NestedWorkflow` ("nwf" — see `assets/nestedWorkflowParent.dar.template.ts`
 *    / `nestedWorkflowChild.dar.template.ts`): this pack is fundamentally two
 *    separate durable Lambda functions, and the PARENT's `.dar` cannot even
 *    be constructed until the CHILD already exists as a real, deployed
 *    Lambda (its qualified ARN is baked into the parent's `.dar`) — breaking
 *    this registry's "infra deploy produces a `.dar` to review, deploying it
 *    as a durable Lambda remains a separate, later, user-triggered action"
 *    model (the "two deploys, not one" design). Wiring it into the picker
 *    would mean selecting this pack silently deploys REAL workflow CODE (the
 *    child function) during what every other pack treats as a passive
 *    infra-only step — a bigger, inconsistent side-effect jump than any
 *    other picker entry makes. Deliberately excluded pending a real UX
 *    decision on how to present a multi-function pack, not a bug.
 *  - `DistributedMapCSVIterator`: not yet vendored under `assets/` at all
 *    (deferred — needs pre-populated S3 input files, a bigger setup lift
 *    than every other pack so far).
 */

export interface StarterPackDeployProgress {
  message: string;
  /** Resource-level progress while the CFN stack is being created, if known. */
  resources?: CfnProgress;
}

export interface StarterPackDeployOptions {
  region: string;
  credentials: AwsCredentialIdentityProvider;
  onProgress?: (progress: StarterPackDeployProgress) => void;
  /** Aborts the deploy (and best-effort deletes the in-progress stack). */
  signal?: AbortSignal;
}

export interface StarterPackDeployResult {
  stackId: string;
  /** The fully-resolved `.dar` JSON, ready to load into Studio. */
  dar: string;
}

/** Reads a required CFN stack output, throwing a clear error if it's missing. */
export function requireOutput(
  outputs: Record<string, string>,
  key: string,
): string {
  const value = outputs[key];
  if (!value) {
    throw new Error(`CFN stack output "${key}" was missing.`);
  }
  return value;
}

/**
 * Per-pack CFN template + CFN-outputs-to-`.dar` mapping. `cfnTemplate` is
 * OPTIONAL: some packs (e.g. `bpc`/BedrockPromptChaining) need no supporting
 * AWS infrastructure at all — once their source ASL's state machine and its
 * now-orphaned execution role are stripped, nothing real is left to
 * provision (see e.g. `bedrockPromptChaining.dar.template.ts`'s header for
 * why). For those, `resolveDar` is called with an empty `outputs` object and
 * must not call {@link requireOutput} on anything.
 */
interface StarterPackDefinition {
  cfnTemplate?: string;
  resolveDar: (outputs: Record<string, string>, region: string) => string;
}

const PACK_DEFINITIONS: Record<StarterPackId, StarterPackDefinition> = {
  hl: {
    cfnTemplate: helloLambdaCfnTemplate,
    resolveDar: (outputs, region) =>
      resolveHelloLambdaDar({
        region,
        checkStockPriceLambdaArn: requireOutput(
          outputs,
          "CheckStockPriceLambdaArn",
        ),
        buyStockLambdaArn: requireOutput(outputs, "BuyStockLambdaArn"),
        sellStockLambdaArn: requireOutput(outputs, "SellStockLambdaArn"),
        requestHumanApprovalSqsUrl: requireOutput(
          outputs,
          "RequestHumanApprovalSqsUrl",
        ),
        reportResultSnsTopicArn: requireOutput(
          outputs,
          "ReportResultSnsTopicArn",
        ),
      }),
  },
  tt: {
    cfnTemplate: taskTimerCfnTemplate,
    resolveDar: (outputs, region) =>
      resolveTaskTimerDar({
        region,
        snsTopicArn: requireOutput(outputs, "SNSTopicArn"),
      }),
  },
  cbt: {
    cfnTemplate: waitForCallbackCfnTemplate,
    resolveDar: (outputs, region) =>
      resolveWaitForCallbackDar({
        region,
        sqsQueueUrl: requireOutput(outputs, "SQSQueueUrl"),
        snsTopicArn: requireOutput(outputs, "SNSTopicArn"),
      }),
  },
  jsp: {
    cfnTemplate: jobStatusPollerCfnTemplate,
    resolveDar: (outputs, region) =>
      resolveJobStatusPollerDar({
        region,
        submitJobFunctionArn: requireOutput(outputs, "SubmitJobFunctionArn"),
        checkJobFunctionArn: requireOutput(outputs, "CheckJobFunctionArn"),
        jobQueueArn: requireOutput(outputs, "SampleJobQueueArn"),
        jobDefinition: requireOutput(outputs, "SampleJobDefinition"),
      }),
  },
  dpp: {
    cfnTemplate: dynamicParallelProcessingCfnTemplate,
    resolveDar: (outputs, region) =>
      resolveDynamicParallelProcessingDar({
        region,
        sqsQueueUrl: requireOutput(outputs, "SQSQueueUrl"),
        ddbTableName: requireOutput(outputs, "DDBTableName"),
        snsTopicArn: requireOutput(outputs, "SNSTopicArn"),
      }),
  },
  ebce: {
    cfnTemplate: eventBridgeCustomEventCfnTemplate,
    resolveDar: (outputs, region) =>
      resolveEventBridgeCustomEventDar({
        region,
        eventBusName: requireOutput(outputs, "EventBusName"),
      }),
  },
  bpc: {
    // No CFN infra at all — see StarterPackDefinition's doc comment above.
    resolveDar: (_outputs, region) =>
      resolveBedrockPromptChainingDar({ region }),
  },
};

/**
 * Deploys a starter pack's CFN infra stack (if it has one) and resolves its
 * `.dar` workflow. Does not deploy the workflow itself as a durable Lambda —
 * that remains a separate, existing, user-triggered action via Studio's own
 * Save/Deploy… flow (the "two deploys, not one" design; see the old
 * `deployStarterPack.ts`'s header, now folded into this file).
 *
 * For packs with no `cfnTemplate` (see {@link StarterPackDefinition}), this
 * skips `createStack`/`waitForStackComplete` entirely and resolves the
 * `.dar` directly from an empty outputs map — there is no stack to create,
 * wait for, or (later) tear down for those packs.
 */
export async function deployStarterPackInfra(
  packId: StarterPackId,
  opts: StarterPackDeployOptions,
): Promise<StarterPackDeployResult> {
  const definition = PACK_DEFINITIONS[packId];
  if (!definition) {
    throw new Error(`Unknown starter pack id "${packId}".`);
  }
  const { region, credentials, onProgress, signal } = opts;
  const { cfnTemplate } = definition;

  if (!cfnTemplate) {
    onProgress?.({ message: "Preparing workflow…" });
    const dar = definition.resolveDar({}, region);
    return { stackId: "", dar };
  }

  const cfnOpts = { region, credentials };
  const metadata = STARTER_PACKS[packId];

  onProgress?.({ message: "Starting deployment…" });
  const stackName = `WorkflowStudio-${metadata.title.replace(/[^\w-]+/g, "")}-${Date.now()}`;
  const stackId = await createStack(cfnOpts, cfnTemplate, stackName);

  const totalResources = countTemplateResources(cfnTemplate);
  const { outputs } = await waitForStackComplete(
    cfnOpts,
    stackId,
    totalResources,
    (resources) =>
      onProgress?.({
        message: resources.currentResource
          ? `Creating ${resources.currentResource}… (${resources.completed}/${resources.total} resources created)`
          : `${resources.completed}/${resources.total} resources created`,
        resources,
      }),
    signal,
  );

  onProgress?.({ message: "Preparing workflow…" });
  const dar = definition.resolveDar(outputs, region);

  return { stackId, dar };
}
