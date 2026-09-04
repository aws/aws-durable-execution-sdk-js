import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";
import { durableRequestHandler } from "../../utils/durable-request-handler";

export const config: ExampleConfig = {
  name: "Durable AWS Client",
  description:
    "Routes an AWS SDK v3 client through context.fetch, so a call to an AWS service " +
    "becomes a durable operation that suspends while the request is in flight",
  // Deploying this would produce a function that cannot work: it needs a real DynamoDB
  // table and `dynamodb:GetItem` on the execution role, neither of which the examples stack
  // provisions. The local test covers the behaviour end to end -- the AWS SDK's middleware
  // stack, signing included, runs for real there; only the socket is substituted.
  localOnly: true,
};

/**
 * Calls an AWS service through `context.fetch` instead of the SDK's own socket.
 *
 * The only change from an ordinary AWS SDK call is `requestHandler`. Everything above it in
 * the middleware stack -- serialization, endpoint resolution, SigV4 signing -- runs
 * unchanged, so the request the durable execution service issues is a normal signed AWS
 * request. The execution suspends while it is in flight, so the round trip is not billed
 * compute, and the response is checkpointed before this handler sees it.
 *
 * DynamoDB is used because it is a plain JSON API. See `durableRequestHandler` for why
 * binary and streaming operations are out of scope.
 */
export const handler = withDurableExecution(
  async (event: { tableName: string; id: string }, context: DurableContext) => {
    const client = new DynamoDBClient({
      requestHandler: durableRequestHandler(context, "get-item"),
      // The workflow owns retries. The SDK's own backoff is an in-Lambda `setTimeout`, which
      // burns billed compute, whereas retrying at the workflow level suspends between
      // attempts -- and re-signs, since each attempt runs in a later invocation.
      maxAttempts: 1,
    });

    const result = await client.send(
      new GetItemCommand({
        TableName: event.tableName,
        Key: { id: { S: event.id } },
      }),
    );

    return { found: result.Item !== undefined };
  },
);
