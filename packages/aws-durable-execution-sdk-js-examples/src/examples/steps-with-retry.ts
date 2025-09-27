import {DurableContext, withDurableFunctions} from "@aws/durable-execution-sdk-js";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";

const ddbClient = new DynamoDBClient();

// Retry policy
const STEP_CONFIG_WITH_RETRY_FAILURES_AFTER_1_SECOND_5_TIMES = {
  retryStrategy: (error: Error, attemptsMade: number) => {
    const shouldRetry = attemptsMade <= 5;
    console.warn(
      `Step Attempt #${attemptsMade}.`,
      error,
      `. Retry? ${shouldRetry}. `,
    );
    if (shouldRetry) {
      return { shouldRetry: true, delaySeconds: 1 };
    } else {
      return { shouldRetry: false };
    }
  },
};

interface HandlerInput {
  name: string;
}

export const handler = withDurableFunctions(async (event: HandlerInput, context: DurableContext) => {
  let item;
  try {
    let pollCount = 0;
    while (pollCount < 5) {
      pollCount += 1;
      // Lookup the item in DDB
      const getResponse = await context.step(async () => {
        console.log(`Poll #${pollCount}`);
        // Fail 50% of the time
        if (Math.random() < 0.5) {
          throw new Error("Random failure");
        }
        return await ddbClient.send(
          new GetItemCommand({
            TableName: "TEST",
            Key: {
              id: {
                S: event.name,
              },
            },
          }),
        );
      }, STEP_CONFIG_WITH_RETRY_FAILURES_AFTER_1_SECOND_5_TIMES);

      // Did the item exist in DDB?
      if (getResponse.Item) {
        item = getResponse.Item;
        break;
      }

      // Wait 5 seconds until next poll
      await context.wait(5000);
    }
  } catch (e) {
    console.error("Failing - DDB Retries Exhausted. ", e);
    throw e;
  }

  if (!item) {
    console.error("Failing - DDB Item Not Found.");
    throw new Error("Item Not Found");
  }

  // We found the item!
  console.log(`Success - Item was found: `, item);
  return item;
});
