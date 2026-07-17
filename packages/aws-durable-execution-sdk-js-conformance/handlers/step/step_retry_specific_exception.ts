// 1-15: Retry specific exception (uses DynamoDB to track attempts)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

const ddbClient = new DynamoDBClient();
const TABLE_NAME = process.env.ATTEMPTS_TABLE_NAME || "Attempts";

class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientError";
  }
}

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

        if (attemptCount < 2) {
          throw new TransientError("Temporary failure");
        }
        return "recovered from transient";
      },
      {
        retryStrategy: (error: Error, attempts: number) => {
          if (error.name === "TransientError" && attempts < 3) {
            return { shouldRetry: true, delay: { seconds: 1 } };
          }
          return { shouldRetry: false };
        },
      },
    );

    return result;
  },
);
