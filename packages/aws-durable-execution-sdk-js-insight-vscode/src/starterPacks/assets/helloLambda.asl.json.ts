/**
 * ASL definition for the "HelloLambda" Step Functions starter pack (id "hl":
 * a stock buy/sell workflow with a human-approval-via-SQS callback step).
 *
 * Source: internal package `@amzn/sfn-console-starter-pack`
 * (code.amazon.com/packages/SFNConsoleStarterPack), file
 * `src/assets/definitions/HelloLambda.json.ts`, mainline, fetched 2026-07-23.
 * Vendored verbatim as a one-time snapshot (not live-synced to upstream).
 *
 * The source file's `${PLACEHOLDERS.PARTITION}` / `${PLACEHOLDERS.REGION}` /
 * `${PLACEHOLDERS.ACCOUNT_ID}` tokens (that package's own CFN-style
 * substitution mechanism) are replaced here with a small `resolveHelloLambdaAsl`
 * helper that fills in real values at import time, since this string is fed
 * directly to our ASL importer (`convertStateMachine` in `aslImport.ts`),
 * which expects a plain ASL document, not a templated one.
 */

const ASL_TEMPLATE = `{
  "StartAt": "Check Stock Price",
  "QueryLanguage": "JSONata",
  "States": {
    "Check Stock Price": {
      "Type": "Task",
      "Resource": "arn:{{PARTITION}}:states:::lambda:invoke",
      "Arguments": {
          "FunctionName": "MyLambdaFunction"
      },
      "Next": "Request Human Approval",
      "QueryLanguage": "JSONata",
      "Assign": {
        "stock_price": "{% $states.result.Payload.stock_price %}",
        "recommended_type": "{% $states.result.Payload.stock_price > 50 ? 'sell' : 'buy' %}"
      }
    },
    "Request Human Approval": {
      "Type": "Task",
      "Resource": "arn:{{PARTITION}}:states:::sqs:sendMessage.waitForTaskToken",
      "Next": "Buy or Sell?",
      "Arguments": {
        "QueueUrl": "https://sqs.{{REGION}}.amazonaws.com/{{ACCOUNT_ID}}/MyQueue",
        "MessageBody": {
          "Input": {
            "stock_price": "{% $stock_price %}",
            "recommended_type": "{% $recommended_type %}"
          },
          "TaskToken": "{% $states.context.Task.Token %}"
        }
      }
    },
    "Buy or Sell?": {
      "Type": "Choice",
      "Choices": [
        {
          "Next": "Buy Stock",
          "Condition": "{% $recommended_type = 'buy' %}"
        },
        {
          "Next": "Sell Stock",
          "Condition": "{% $recommended_type = 'sell' %}"
        }
      ]
    },
    "Buy Stock": {
      "Type": "Task",
      "Resource": "arn:{{PARTITION}}:states:::lambda:invoke",
      "Next": "Report Result",
      "Arguments": {
        "FunctionName": "MyLambdaFunction",
        "Payload": {
          "stock_price": "{% $stock_price %}",
          "recommended_type": "{% $recommended_type %}"
        }
      }
    },
    "Sell Stock": {
      "Type": "Task",
      "Resource": "arn:{{PARTITION}}:states:::lambda:invoke",
      "Next": "Report Result",
      "Arguments": {
        "FunctionName": "MyLambdaFunction",
        "Payload": {
          "stock_price": "{% $stock_price %}",
          "recommended_type": "{% $recommended_type %}"
        }
      }
    },
    "Report Result": {
      "Type": "Task",
      "Resource": "arn:{{PARTITION}}:states:::sns:publish",
      "End": true,
      "Arguments": {
        "Message": "{% $states.input %}",
        "TopicArn": "arn:{{PARTITION}}:sns:{{REGION}}:{{ACCOUNT_ID}}:MySnsTopic"
      }
    }
  }
}`;

export interface HelloLambdaAslContext {
  partition: string;
  region: string;
  accountId: string;
  /** Real queue URL from the deployed CFN stack's outputs. */
  queueUrl: string;
  /** Real SNS topic ARN from the deployed CFN stack's outputs. */
  topicArn: string;
}

/**
 * Fills in the ASL template's placeholders with real values from a deployed
 * CFN stack, producing a plain ASL document ready for `convertStateMachine`.
 */
export function resolveHelloLambdaAsl(ctx: HelloLambdaAslContext): string {
  return ASL_TEMPLATE.replace(/\{\{PARTITION\}\}/g, ctx.partition)
    .replace(/\{\{REGION\}\}/g, ctx.region)
    .replace(/\{\{ACCOUNT_ID\}\}/g, ctx.accountId)
    .replace(
      `https://sqs.${ctx.region}.amazonaws.com/${ctx.accountId}/MyQueue`,
      ctx.queueUrl,
    )
    .replace(
      `arn:${ctx.partition}:sns:${ctx.region}:${ctx.accountId}:MySnsTopic`,
      ctx.topicArn,
    );
}

export default ASL_TEMPLATE;
