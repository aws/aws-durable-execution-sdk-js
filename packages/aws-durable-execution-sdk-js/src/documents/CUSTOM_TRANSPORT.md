# Custom transport

By default the SDK talks to the Lambda durable execution APIs. You can replace that
transport with your own by implementing `DurableExecutionClient`, which has two operations
and names no AWS types:

```typescript
import {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  DurableExecutionClient,
  DurableExecutionClientError,
  DurableExecutionClientErrorScope,
  GetDurableExecutionStateRequest,
  GetDurableExecutionStateResponse,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

class HttpDurableExecutionClient implements DurableExecutionClient {
  constructor(private readonly endpoint: string) {}

  async getExecutionState(
    params: GetDurableExecutionStateRequest,
  ): Promise<GetDurableExecutionStateResponse> {
    const response = await fetch(`${this.endpoint}/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw this.toClientError(
        "Failed to read execution state",
        response.status,
      );
    }

    return response.json() as Promise<GetDurableExecutionStateResponse>;
  }

  async checkpoint(
    params: CheckpointDurableExecutionRequest,
  ): Promise<CheckpointDurableExecutionResponse> {
    const response = await fetch(`${this.endpoint}/checkpoint`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw this.toClientError("Checkpoint failed", response.status);
    }

    return response.json() as Promise<CheckpointDurableExecutionResponse>;
  }

  // Tell the SDK whether to end just this invocation or the whole execution.
  private toClientError(
    message: string,
    status: number,
  ): DurableExecutionClientError {
    return new DurableExecutionClientError(`${message}: ${status}`, {
      scope:
        status >= 400 && status < 500 && status !== 429
          ? // A rejected request will not succeed on retry.
            DurableExecutionClientErrorScope.EXECUTION
          : // Throttling and server-side errors may.
            DurableExecutionClientErrorScope.INVOCATION,
    });
  }
}

export const handler = withDurableExecution(myHandler, {
  durableExecutionClient: new HttpDurableExecutionClient(
    process.env.DURABLE_ENDPOINT!,
  ),
});
```

Without a stated scope, every failure is treated as transient, so a permanent one is retried
until the execution times out. Note that a stated scope is believed ahead of the SDK's own
error inspection, so a transport that wraps another one takes over responsibility for
classifying the errors it wraps.

To keep the Lambda transport but configure the underlying client yourself, pass it to
`DurableExecutionApiClient` rather than using the deprecated `client` option:

```typescript
import { DurableExecutionApiClient } from "@aws/durable-execution-sdk-js";
import { LambdaClient } from "@aws-sdk/client-lambda";

export const handler = withDurableExecution(myHandler, {
  durableExecutionClient: new DurableExecutionApiClient(
    new LambdaClient({ region: "us-west-2", maxAttempts: 5 }),
  ),
});
```
