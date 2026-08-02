/**
 * `.dar` workflow for the "HelloLambda" Step Functions starter pack (id
 * "hl"), hand-authored from the pack's ASL definition (see
 * `helloLambda.asl.json.ts`) after fixing two importer/model mismatches
 * discovered and verified during a real end-to-end deploy + execute + verify
 * + teardown run against account 730758745077 on 2026-07-23:
 *
 *  1. **"Request Human Approval" callback semantics**: the source ASL uses
 *     Step Functions' `sqs:sendMessage.waitForTaskToken` (that service's
 *     callback mechanism). Our SDK's equivalent is `context.waitForCallback`
 *     - a different mechanism entirely (Lambda's own
 *     `SendDurableExecutionCallbackSuccess`/`Failure` APIs, not Step
 *     Functions'). The ASL importer's best-effort translation produced a
 *     structurally-valid but semantically wrong submitter (publishing a
 *     Step-Functions-shaped `{ Input, TaskToken }` envelope); this template
 *     publishes `{ callbackId, stock_price, recommended_type }` instead, and
 *     the paired `ApproveSqsLambda` (see `helloLambda.cfn.yaml.ts`) calls
 *     `SendDurableExecutionCallbackSuccessCommand` with a `Result` carrying
 *     those same fields back.
 *  2. **No implicit "current input" across nodes**: unlike ASL's `Assign`
 *     (persistent execution-scoped variables), the generated handler binds
 *     each node's result to its OWN named const (e.g. `Check_Stock_Price`,
 *     `Request_Human_Approval`) - there is no generic rolling `input` that
 *     auto-updates. Every downstream reference must name the specific prior
 *     node explicitly. (The importer's own output incorrectly assumed a
 *     rolling `input`, which is why the first real deploy of this template
 *     failed with "Cannot read properties of undefined" on the post-callback
 *     branches - fixed here by referencing `Check_Stock_Price`/
 *     `Request_Human_Approval` by name.)
 *  3. **Callback result deserialization**: `context.waitForCallback`'s
 *     result is NOT JSON-parsed by default (see
 *     `Serdes`/`defaultCallbackDeserializer` in the SDK - falls back to a
 *     raw-string passthrough unless a custom deserializer is configured).
 *     `ApproveSqsLambda` sends a JSON string as `Result`; this template's
 *     code defensively JSON.parses it (and also handles the case where it's
 *     already an object, since `validateDarJson`'s dry-run mock resolves
 *     `waitForCallback` to a plain `{}`, not a string).
 *
 * Placeholders (`{{...}}`) are filled in by {@link resolveHelloLambdaDar}
 * from a deployed CFN stack's outputs (see `../cfnDeploy.ts` /
 * `helloLambda.cfn.yaml.ts`).
 */

const DAR_TEMPLATE = `{
  "darVersion": "1.0",
  "name": "HelloLambda",
  "dependencyMode": "linear",
  "nodes": [
    {
      "id": "start",
      "kind": "start",
      "name": "Start",
      "position": { "x": 40, "y": 0 }
    },
    {
      "id": "Check_Stock_Price",
      "name": "Check Stock Price",
      "position": { "x": 40, "y": 150 },
      "kind": "chainInvoke",
      "functionArn": "{{CHECK_STOCK_PRICE_LAMBDA_ARN}}",
      "payload": "{}"
    },
    {
      "id": "Request_Human_Approval",
      "name": "Request Human Approval",
      "position": { "x": 40, "y": 300 },
      "kind": "callback",
      "timeoutValue": 24,
      "timeoutUnit": "hours",
      "submitterCode": "const { SQSClient, SendMessageCommand } = require(\\"@aws-sdk/client-sqs\\");\\n\\nconst sqsClient = new SQSClient({ region: \\"{{REGION}}\\" });\\n\\nawait sqsClient.send(\\n  new SendMessageCommand({\\n    QueueUrl: \\"{{REQUEST_HUMAN_APPROVAL_SQS_URL}}\\",\\n    MessageBody: JSON.stringify({\\n      callbackId,\\n      stock_price: Check_Stock_Price.stock_price,\\n      recommended_type: Check_Stock_Price.stock_price > 50 ? 'sell' : 'buy',\\n    }),\\n  }),\\n);"
    },
    {
      "id": "Buy_or_Sell_",
      "name": "Buy or Sell?",
      "position": { "x": 40, "y": 450 },
      "kind": "condition",
      "code": "const approval = (typeof Request_Human_Approval === 'string' ? JSON.parse(Request_Human_Approval) : Request_Human_Approval); if (approval.recommended_type === 'buy') return 'Buy Stock'; else return 'Sell Stock';"
    },
    {
      "id": "Buy_Stock",
      "name": "Buy Stock",
      "position": { "x": 40, "y": 600 },
      "kind": "chainInvoke",
      "functionArn": "{{BUY_STOCK_LAMBDA_ARN}}",
      "payload": "(() => { const a = (typeof Request_Human_Approval === 'string' ? JSON.parse(Request_Human_Approval) : Request_Human_Approval); return { stock_price: a.stock_price, recommended_type: a.recommended_type }; })()"
    },
    {
      "id": "Sell_Stock",
      "name": "Sell Stock",
      "position": { "x": 40, "y": 750 },
      "kind": "chainInvoke",
      "functionArn": "{{SELL_STOCK_LAMBDA_ARN}}",
      "payload": "(() => { const a = (typeof Request_Human_Approval === 'string' ? JSON.parse(Request_Human_Approval) : Request_Human_Approval); return { stock_price: a.stock_price, recommended_type: a.recommended_type }; })()"
    },
    {
      "id": "Report_Result",
      "name": "Report Result",
      "position": { "x": 40, "y": 900 },
      "kind": "step",
      "code": "const { SNSClient, PublishCommand } = require(\\"@aws-sdk/client-sns\\");\\n\\nconst snsClient = new SNSClient({ region: \\"{{REGION}}\\" });\\nconst approval = (typeof Request_Human_Approval === 'string' ? JSON.parse(Request_Human_Approval) : Request_Human_Approval);\\n\\nconst response = await snsClient.send(\\n  new PublishCommand({\\n    Message: JSON.stringify(approval),\\n    TopicArn: \\"{{REPORT_RESULT_SNS_TOPIC_ARN}}\\",\\n  })\\n);\\n\\nreturn {\\n  MessageId: response.MessageId,\\n};",
      "terminal": true
    }
  ],
  "edges": [
    { "id": "e0_start_Check_Stock_Price", "source": "start", "target": "Check_Stock_Price" },
    { "id": "e1_Check_Stock_Price_Request_Human_Approval", "source": "Check_Stock_Price", "target": "Request_Human_Approval" },
    { "id": "e2_Request_Human_Approval_Buy_or_Sell_", "source": "Request_Human_Approval", "target": "Buy_or_Sell_" },
    { "id": "e3_Buy_or_Sell__Buy_Stock", "source": "Buy_or_Sell_", "target": "Buy_Stock", "match": "Buy Stock" },
    { "id": "e4_Buy_or_Sell__Sell_Stock", "source": "Buy_or_Sell_", "target": "Sell_Stock", "match": "Sell Stock" },
    { "id": "e5_Buy_Stock_Report_Result", "source": "Buy_Stock", "target": "Report_Result" },
    { "id": "e6_Sell_Stock_Report_Result", "source": "Sell_Stock", "target": "Report_Result" }
  ]
}`;

export interface HelloLambdaDarContext {
  region: string;
  checkStockPriceLambdaArn: string;
  buyStockLambdaArn: string;
  sellStockLambdaArn: string;
  requestHumanApprovalSqsUrl: string;
  reportResultSnsTopicArn: string;
}

/** Fills in the .dar template's placeholders from a deployed CFN stack's outputs. */
export function resolveHelloLambdaDar(ctx: HelloLambdaDarContext): string {
  return DAR_TEMPLATE.replace(/\{\{REGION\}\}/g, ctx.region)
    .replace("{{CHECK_STOCK_PRICE_LAMBDA_ARN}}", ctx.checkStockPriceLambdaArn)
    .replace("{{BUY_STOCK_LAMBDA_ARN}}", ctx.buyStockLambdaArn)
    .replace("{{SELL_STOCK_LAMBDA_ARN}}", ctx.sellStockLambdaArn)
    .replace(
      "{{REQUEST_HUMAN_APPROVAL_SQS_URL}}",
      ctx.requestHumanApprovalSqsUrl,
    )
    .replace("{{REPORT_RESULT_SNS_TOPIC_ARN}}", ctx.reportResultSnsTopicArn);
}

export default DAR_TEMPLATE;
