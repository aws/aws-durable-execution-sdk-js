// 1-18: AtMostOnce interrupted (with retry, succeeds on second attempt)
import {
  DurableContext,
  withDurableExecution,
  StepSemantics,
} from "@aws/durable-execution-sdk-js";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

const ddbClient = new DynamoDBClient();
const TABLE_NAME = process.env.ATTEMPTS_TABLE_NAME || "Attempts";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const executionId = context.executionContext.durableExecutionArn;

    const result = await context.step(
      async () => {
        // Atomically increment attempt counter in DynamoDB
        const response = await ddbClient.send(
          new UpdateItemCommand({
            TableName: TABLE_NAME,
            Key: {
              executionId: { S: executionId },
            },
            UpdateExpression:
              "SET attemptCount = if_not_exists(attemptCount, :zero) + :inc",
            ExpressionAttributeValues: {
              ":zero": { N: "0" },
              ":inc": { N: "1" },
            },
            ReturnValues: "UPDATED_NEW",
          }),
        );

        const attemptCount = Number(response.Attributes?.attemptCount?.N ?? 0);

        // Print input to stdout each time step executes
        console.log(event);

        if (attemptCount < 2) {
          // Allow time for logs to flush to CloudWatch before crashing
          await new Promise((resolve) => setTimeout(resolve, 1000));
          // First attempt: simulate Lambda crash
          process.exit(1);
        }
        // Second attempt (retry): succeed
        return "succeeded on second attempt";
      },
      {
        semantics: StepSemantics.AtMostOncePerRetry,
        retryStrategy: (error: Error, attempts: number) => {
          if (attempts >= 3) {
            return { shouldRetry: false };
          }
          return { shouldRetry: true, delay: { seconds: 1 } };
        },
      },
    );
    return result;
  },
);
