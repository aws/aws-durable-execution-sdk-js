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
  SendDurableExecutionCallbackSuccessRequest,
} from "@aws-sdk/client-lambda";

export interface DurableApiClient {
  sendCallbackSuccess: (
    request: SendDurableExecutionCallbackSuccessRequest,
  ) => Promise<SendDurableExecutionCallbackSuccessResponse>;
  sendCallbackFailure: (
    request: SendDurableExecutionCallbackFailureRequest,
  ) => Promise<SendDurableExecutionCallbackFailureResponse>;
  sendCallbackHeartbeat: (
    request: SendDurableExecutionCallbackHeartbeatRequest,
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
