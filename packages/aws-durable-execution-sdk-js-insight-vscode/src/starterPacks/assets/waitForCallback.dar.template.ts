/**
 * `.dar` workflow for the "WaitForCallback" Step Functions starter pack
 * (id "cbt"). Hand-authored (not machine-imported) applying the lessons from
 * HelloLambda's real verification run - see helloLambda.dar.template.ts's
 * header for the general rationale. Same callback-semantics fix applies
 * here (context.waitForCallback + Lambda's own
 * SendDurableExecutionCallbackSuccess, not Step Functions' SendTaskSuccess).
 *
 * New pattern this pack exercises (HelloLambda had none): ASL's `Catch`
 * clause -> a `kind: "error"` edge from the callback node to the failure
 * node. No `errorType` on the edge = catch-all, matching ASL's
 * `ErrorEquals: ["States.ALL"]`. context.waitForCallback throws
 * CallbackError/CallbackTimeoutError/CallbackExternalError on failure (see
 * durable-error.ts) - any of those triggers the error edge.
 */

const DAR_TEMPLATE = `{
  "darVersion": "1.0",
  "name": "WaitForCallback",
  "dependencyMode": "linear",
  "nodes": [
    {
      "id": "start",
      "kind": "start",
      "name": "Start",
      "position": { "x": 40, "y": 0 }
    },
    {
      "id": "Start_Task_And_Wait_For_Callback",
      "name": "Start Task And Wait For Callback",
      "position": { "x": 40, "y": 150 },
      "kind": "callback",
      "timeoutValue": 24,
      "timeoutUnit": "hours",
      "submitterCode": "const { SQSClient, SendMessageCommand } = require(\\"@aws-sdk/client-sqs\\");\\n\\nconst sqsClient = new SQSClient({ region: \\"{{REGION}}\\" });\\n\\nawait sqsClient.send(\\n  new SendMessageCommand({\\n    QueueUrl: \\"{{SQS_QUEUE_URL}}\\",\\n    MessageBody: JSON.stringify({\\n      callbackId,\\n      messageTitle: \\"Task started by Step Functions. Waiting for callback with task token.\\",\\n    }),\\n  }),\\n);"
    },
    {
      "id": "Notify_Success",
      "name": "Notify Success",
      "position": { "x": 40, "y": 300 },
      "kind": "step",
      "code": "const { SNSClient, PublishCommand } = require(\\"@aws-sdk/client-sns\\");\\n\\nconst snsClient = new SNSClient({ region: \\"{{REGION}}\\" });\\n\\nconst response = await snsClient.send(\\n  new PublishCommand({\\n    Message: \\"Callback received. Task started by Step Functions succeeded.\\",\\n    TopicArn: \\"{{SNS_TOPIC_ARN}}\\",\\n  })\\n);\\n\\nreturn {\\n  MessageId: response.MessageId,\\n};",
      "terminal": true
    },
    {
      "id": "Notify_Failure",
      "name": "Notify Failure",
      "position": { "x": 300, "y": 300 },
      "kind": "step",
      "code": "const { SNSClient, PublishCommand } = require(\\"@aws-sdk/client-sns\\");\\n\\nconst snsClient = new SNSClient({ region: \\"{{REGION}}\\" });\\n\\nconst response = await snsClient.send(\\n  new PublishCommand({\\n    Message: \\"Task started by Step Functions failed.\\",\\n    TopicArn: \\"{{SNS_TOPIC_ARN}}\\",\\n  })\\n);\\n\\nreturn {\\n  MessageId: response.MessageId,\\n};",
      "terminal": true
    }
  ],
  "edges": [
    { "id": "e0_start_Start_Task_And_Wait_For_Callback", "source": "start", "target": "Start_Task_And_Wait_For_Callback" },
    { "id": "e1_Start_Task_And_Wait_For_Callback_Notify_Success", "source": "Start_Task_And_Wait_For_Callback", "target": "Notify_Success" },
    { "id": "e2_Start_Task_And_Wait_For_Callback_Notify_Failure", "source": "Start_Task_And_Wait_For_Callback", "target": "Notify_Failure", "kind": "error" }
  ]
}`;

export interface WaitForCallbackDarContext {
  region: string;
  sqsQueueUrl: string;
  snsTopicArn: string;
}

/** Fills in the .dar template's placeholders from a deployed CFN stack's outputs. */
export function resolveWaitForCallbackDar(
  ctx: WaitForCallbackDarContext,
): string {
  return DAR_TEMPLATE.replace(/\{\{REGION\}\}/g, ctx.region)
    .replace("{{SQS_QUEUE_URL}}", ctx.sqsQueueUrl)
    .replace(/\{\{SNS_TOPIC_ARN\}\}/g, ctx.snsTopicArn);
}

export default DAR_TEMPLATE;
