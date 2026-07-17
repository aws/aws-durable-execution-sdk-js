// 1-14: Retry with custom config (uses DynamoDB to track attempts)
import {
  DurableContext,
  withDurableExecution,
  createRetryStrategy,
  JitterStrategy,
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

        if (attemptCount < 3) {
          throw new Error(`Attempt ${attemptCount} failed`);
        }
        return "finally succeeded";
      },
      {
        retryStrategy: createRetryStrategy({
          maxAttempts: 5,
          initialDelay: { seconds: 2 },
          backoffRate: 3,
          jitter: JitterStrategy.NONE,
        }),
      },
    );

    return result;
  },
);
