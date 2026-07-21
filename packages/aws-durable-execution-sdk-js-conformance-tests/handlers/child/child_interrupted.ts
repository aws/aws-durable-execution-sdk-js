// 3-12: Child context interrupted and re-executed
//
// NOTE: This handler intentionally keeps DynamoDB-based attempt counting
// (unlike the retry handlers, which use the SDK-native stepContext.attempt).
// The step here crashes via process.exit(1) with no retry strategy, and the
// SDK only checkpoints the attempt counter on FAIL/RETRY decisions — not on a
// sandbox crash. On re-invocation stepContext.attempt would still read 1,
// crashing forever. Counting cross-invocation executions requires external
// state.
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

const ddbClient = new DynamoDBClient();
const TABLE_NAME = process.env.ATTEMPTS_TABLE_NAME || "Attempts";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const executionId = context.executionContext.durableExecutionArn;

    const result = await context.runInChildContext(
      async (childContext: DurableContext) => {
        const stepResult = await childContext.step(async () => {
          // Track invocation count in DynamoDB
          const response = await ddbClient.send(
            new UpdateItemCommand({
              TableName: TABLE_NAME,
              Key: {
                executionId: { S: `${executionId}-child-interrupted` },
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

          const attemptCount = Number(
            response.Attributes?.attemptCount?.N ?? 0,
          );

          if (attemptCount < 2) {
            // Sleep to allow checkpoint to be sent before crash
            await new Promise((resolve) => setTimeout(resolve, 1000));
            // Simulate Lambda crash/timeout
            process.exit(1);
          }

          return event as string;
        });
        return stepResult;
      },
    );
    return result;
  },
);
