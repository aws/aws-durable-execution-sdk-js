import {
  LambdaClient,
  SendDurableExecutionCallbackFailureCommand,
  SendDurableExecutionCallbackFailureCommandOutput,
  SendDurableExecutionCallbackHeartbeatCommand,
  SendDurableExecutionCallbackHeartbeatCommandOutput,
  SendDurableExecutionCallbackSuccessCommand,
  SendDurableExecutionCallbackSuccessCommandOutput,
  SendDurableExecutionCallbackSuccessCommandInput,
  SendDurableExecutionCallbackFailureCommandInput,
  SendDurableExecutionCallbackHeartbeatCommandInput,
} from "@aws-sdk/client-lambda";

export interface DurableApiClient {
  sendCallbackSuccess: (
    request: SendDurableExecutionCallbackSuccessCommandInput
  ) => Promise<SendDurableExecutionCallbackSuccessCommandOutput>;
  sendCallbackFailure: (
    request: SendDurableExecutionCallbackFailureCommandInput
  ) => Promise<SendDurableExecutionCallbackFailureCommandOutput>;
  sendCallbackHeartbeat: (
    request: SendDurableExecutionCallbackHeartbeatCommandInput
  ) => Promise<SendDurableExecutionCallbackHeartbeatCommandOutput>;
}

export function createDurableApiClient(
  getClient: () => LambdaClient
): DurableApiClient {
  return {
    sendCallbackSuccess: (request) => {
      const client = getClient();
      return client.send(
        new SendDurableExecutionCallbackSuccessCommand(request)
      );
    },
    sendCallbackFailure: (request) => {
      const client = getClient();
      return client.send(
        new SendDurableExecutionCallbackFailureCommand(request)
      );
    },
    sendCallbackHeartbeat: (request) => {
      const client = getClient();
      return client.send(
        new SendDurableExecutionCallbackHeartbeatCommand(request)
      );
    },
  };
}
