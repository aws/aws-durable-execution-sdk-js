/**
 * "Choose a Starter Pack" modal: a grid of cards (icon + title + description +
 * resource summary) shown BEFORE `StarterPackModal`'s deploy/progress/review
 * flow, modeled after the AWS Step Functions console's own "Get Started"
 * template gallery. Selecting a card calls `onSelect` with that pack's id and
 * dismisses itself; the caller (StudioPage) then opens `StarterPackModal`
 * parameterized by the chosen pack.
 *
 * `STARTER_PACKS_METADATA` below is the webview's own copy of the host's
 * `src/starterPacks/registry.ts`'s `STARTER_PACKS` — the webview can't import
 * from the host's `src/` (separate TS projects/bundles), and there's no
 * existing cross-project constant-sharing pattern in this codebase (types are
 * duplicated per-file with "kept in sync" comments — see `types.ts`), so this
 * follows the same convention. Keep in sync with the host's copy by hand.
 */
import Modal from "@cloudscape-design/components/modal";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import Cards from "@cloudscape-design/components/cards";
import Icon from "@cloudscape-design/components/icon";
import type { IconProps } from "@cloudscape-design/components/icon";
import type { StarterPackId } from "../types";

export interface StarterPackCardMetadata {
  id: StarterPackId;
  title: string;
  description: string;
  /** A Cloudscape icon name (built-in or registered custom icon). */
  icon: IconProps.Name;
  /** Short bullets of the real AWS resources the pack's CFN stack creates. Empty for a pack with no supporting infra (see `hasInfra`). */
  resourceSummary: string[];
  /**
   * True when the pack's workflow uses `dag` dependency mode, which has no
   * runtime yet — codegen emits `context.dag(...)` and the SDK does not implement
   * it, so a deployed function fails at invoke time. Hidden from this picker
   * unless dag mode is explicitly enabled. Keep in sync with the host registry's
   * `requiresDagRuntime`.
   */
  requiresDagRuntime?: boolean;
  /** Whether this pack creates a CloudFormation stack at all (false = just the durable Lambda itself, no supporting AWS resources). */
  hasInfra: boolean;
}

/**
 * Kept in sync with the host's `src/starterPacks/registry.ts`'s
 * `STARTER_PACKS`. NestedWorkflow ("nwf") is intentionally NOT listed here —
 * see that file's "packs deliberately excluded from the picker" note for why
 * (it's two separate durable Lambda functions, and its parent's `.dar` can't
 * be built without first deploying the child as a real Lambda, breaking this
 * picker's "infra-only, no workflow code deployed yet" model).
 */
export const STARTER_PACKS_METADATA: StarterPackCardMetadata[] = [
  {
    id: "hl",
    title: "Human Approval Workflow",
    description:
      "Checks a stock price, waits for a human to approve a buy/sell recommendation via a callback, then executes the trade and reports the result.",
    icon: "gen-ai",
    resourceSummary: ["5 Lambda functions", "1 SQS queue", "1 SNS topic"],
    hasInfra: true,
  },
  {
    id: "tt",
    title: "Task Timer",
    description:
      "Waits for a configurable duration, then publishes a notification to an SNS topic. The simplest possible wait-then-notify pattern.",
    icon: "calendar",
    resourceSummary: ["1 SNS topic"],
    hasInfra: true,
  },
  {
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
  {
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
    requiresDagRuntime: true,
  },
  {
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
    requiresDagRuntime: true,
  },
  {
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
  {
    id: "bpc",
    title: "Bedrock Prompt Chaining",
    description:
      "Chains a sequence of prompts to an Amazon Bedrock foundation model, feeding each response into the next prompt to build a connected conversation.",
    icon: "gen-ai",
    resourceSummary: [],
    hasInfra: false,
  },
];

export function StarterPackPickerModal({
  dagEnabled = false,
  visible,
  onDismiss,
  onSelect,
}: {
  visible: boolean;
  onDismiss: () => void;
  /** Called with the chosen pack's id; the caller dismisses this modal itself. */
  onSelect: (packId: StarterPackId) => void;
  /**
   * Whether `dag` dependency mode is enabled. When false (the default), packs
   * marked `requiresDagRuntime` are hidden: they would generate a call to a
   * runtime the SDK does not implement, so choosing one produces a workflow that
   * cannot be deployed.
   */
  dagEnabled?: boolean;
}) {
  const packs = STARTER_PACKS_METADATA.filter(
    (p) => dagEnabled || !p.requiresDagRuntime,
  );
  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header="Deploy a Starter Pack"
      size="large"
      footer={
        <Box float="right">
          <Button variant="link" onClick={onDismiss}>
            Cancel
          </Button>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box variant="p" color="text-status-inactive">
          Choose a starter pack to deploy. Most packs provision their own
          supporting AWS infrastructure (via CloudFormation) and produce a
          ready-to-review durable workflow wired up to it; a few need no
          supporting infrastructure at all.
        </Box>
        {/* Fixed-height, internally-scrollable container: the card grid can
            grow past the viewport height as more packs are added (7 as of
            this writing), and Cloudscape's Modal does not cap/scroll its own
            body — without this, the modal itself grows taller than the
            screen instead of scrolling internally. maxHeight is a viewport-
            relative value (not a fixed px) so it still fits on smaller
            screens/windows. */}
        <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
          <Cards
            cardDefinition={{
              header: (item: StarterPackCardMetadata) => (
                <SpaceBetween
                  direction="horizontal"
                  size="xs"
                  alignItems="center"
                >
                  <Icon name={item.icon} size="medium" />
                  <span>{item.title}</span>
                </SpaceBetween>
              ),
              sections: [
                {
                  id: "description",
                  content: (item: StarterPackCardMetadata) =>
                    item.description,
                },
                {
                  id: "resources",
                  content: (item: StarterPackCardMetadata) => (
                    <Box variant="small" color="text-status-inactive">
                      {item.resourceSummary.join(" · ")}
                    </Box>
                  ),
                },
              ],
            }}
            cardsPerRow={[
              { cards: 1 },
              { minWidth: 600, cards: 2 },
              { minWidth: 1000, cards: 3 },
            ]}
            items={packs}
            trackBy="id"
            entireCardClickable
            onSelectionChange={({ detail }) => {
              const item = detail.selectedItems[0];
              if (item) onSelect(item.id);
            }}
            selectionType="single"
            ariaLabels={{
              itemSelectionLabel: (_state, item) => `Select ${item.title}`,
              selectionGroupLabel: "Starter pack selection",
            }}
          />
        </div>
      </SpaceBetween>
    </Modal>
  );
}
