/**
 * `.dar` workflow for the "TaskTimer" Step Functions starter pack (id "tt").
 * Hand-authored (not machine-imported) following the same convention as
 * `helloLambda.dar.template.ts` - see that file's header for the general
 * "why hand-author, not import" rationale (in short: the ASL importer's
 * best-effort translation has known gaps around our SDK's actual codegen
 * semantics, discovered during HelloLambda's real verification run).
 *
 * This pack is structurally the simplest possible: Wait -> one SNS publish,
 * no branching, no callback, no chained invoke - a deliberate "does the
 * straightforward path still work" sanity check before tackling packs with
 * new structural patterns (polling loops, Map states, etc.).
 *
 * Faithful to the original ASL's fully input-driven design: `topic`,
 * `message`, and `timer_seconds` all come from the invocation input (no
 * baked-in resource references needed at all, unlike HelloLambda) - the
 * deployed SNS topic's ARN is only used as a fallback default so an empty
 * `{}` test payload still does something sensible.
 */

const DAR_TEMPLATE = `{
  "darVersion": "1.0",
  "name": "TaskTimer",
  "dependencyMode": "linear",
  "nodes": [
    {
      "id": "start",
      "kind": "start",
      "name": "Start",
      "position": { "x": 40, "y": 0 }
    },
    {
      "id": "Wait_for_Timestamp",
      "name": "Wait for Timestamp",
      "position": { "x": 40, "y": 150 },
      "kind": "wait",
      "durationValue": 10,
      "durationUnit": "seconds",
      "durationCode": "return input.timer_seconds ?? 10;"
    },
    {
      "id": "Send_SNS_Message",
      "name": "Send SNS Message",
      "position": { "x": 40, "y": 300 },
      "kind": "step",
      "code": "const { SNSClient, PublishCommand } = require(\\"@aws-sdk/client-sns\\");\\n\\nconst snsClient = new SNSClient({ region: \\"{{REGION}}\\" });\\n\\nconst response = await snsClient.send(\\n  new PublishCommand({\\n    TopicArn: input.topic ?? \\"{{SNS_TOPIC_ARN}}\\",\\n    Message: input.message ?? \\"HelloWorld\\",\\n  })\\n);\\n\\nreturn {\\n  MessageId: response.MessageId,\\n};",
      "terminal": true
    }
  ],
  "edges": [
    { "id": "e0_start_Wait_for_Timestamp", "source": "start", "target": "Wait_for_Timestamp" },
    { "id": "e1_Wait_for_Timestamp_Send_SNS_Message", "source": "Wait_for_Timestamp", "target": "Send_SNS_Message" }
  ]
}`;

export interface TaskTimerDarContext {
  region: string;
  snsTopicArn: string;
}

/** Fills in the .dar template's placeholders from a deployed CFN stack's outputs. */
export function resolveTaskTimerDar(ctx: TaskTimerDarContext): string {
  return DAR_TEMPLATE.replace(/\{\{REGION\}\}/g, ctx.region).replace(
    "{{SNS_TOPIC_ARN}}",
    ctx.snsTopicArn,
  );
}

export default DAR_TEMPLATE;
