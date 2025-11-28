import {
  LambdaClient,
  SendDurableExecutionCallbackFailureCommand,
  SendDurableExecutionCallbackHeartbeatCommand,
  SendDurableExecutionCallbackSuccessCommand,
  SendDurableExecutionCallbackSuccessResponse,
  SendDurableExecutionCallbackFailureRequest,
  SendDurableExecutionCallbackFailureResponse,
  SendDurableExecutionCallbackHeartbeatResponse,
  SendDurableExecutionCallbackHeartbeatRequest,
  SendDurableExecutionCallbackSuccessCommandInput,
  SendDurableExecutionCallbackFailureCommandInput,
  SendDurableExecutionCallbackHeartbeatCommandInput,
} from "@aws-sdk/client-lambda";

export interface DurableApiClient {
  sendCallbackSuccess: (
    request: SendDurableExecutionCallbackSuccessCommandInput,
  ) => Promise<SendDurableExecutionCallbackSuccessResponse>;
  sendCallbackFailure: (
    request: SendDurableExecutionCallbackFailureCommandInput,
  ) => Promise<SendDurableExecutionCallbackFailureResponse>;
  sendCallbackHeartbeat: (
    request: SendDurableExecutionCallbackHeartbeatCommandInput,
  ) => Promise<SendDurableExecutionCallbackHeartbeatResponse>;
}

export function createDurableApiClient(
  getClient: () => LambdaClient,
): DurableApiClient {
  return {
    sendCallbackSuccess: (request) => {
      const client = getClient();
      return client.send(
        new SendDurableExecutionCallbackSuccessCommand(request),
      );
    },
    sendCallbackFailure: (request) => {
      const client = getClient();
      return client.send(
        new SendDurableExecutionCallbackFailureCommand(request),
      );
    },
    sendCallbackHeartbeat: (request) => {
      const client = getClient();
      return client.send(
        new SendDurableExecutionCallbackHeartbeatCommand(request),
      );
    },
  };
}
