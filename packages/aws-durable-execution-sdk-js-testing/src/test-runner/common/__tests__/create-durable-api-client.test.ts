import {
  LambdaClient,
  SendDurableExecutionCallbackFailureCommand,
  SendDurableExecutionCallbackHeartbeatCommand,
  SendDurableExecutionCallbackSuccessCommand,
} from "@aws-sdk/client-lambda";
import { createDurableApiClient } from "../create-durable-api-client";

describe("create-durable-api-client", () => {
  const client = {
    send: jest.fn(),
  } as unknown as LambdaClient;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should create client with expected properties", () => {
    expect(createDurableApiClient(() => client)).toEqual({
      sendCallbackSuccess: expect.any(Function),
      sendCallbackFailure: expect.any(Function),
      sendCallbackHeartbeat: expect.any(Function),
    });
  });

  it("should call correct API for sendCallbackSuccess", async () => {
    const apiClient = createDurableApiClient(() => client);
    await apiClient.sendCallbackSuccess({
      CallbackId: "CallbackId",
    });

    expect(client.send).toHaveBeenCalledWith(
      expect.any(SendDurableExecutionCallbackSuccessCommand)
    );
    expect(client.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          CallbackId: "CallbackId",
        },
      })
    );
  });

  it("should call correct API for sendCallbackFailure", async () => {
    const apiClient = createDurableApiClient(() => client);

    await apiClient.sendCallbackFailure({
      CallbackId: "CallbackId",
    });

    expect(client.send).toHaveBeenCalledWith(
      expect.any(SendDurableExecutionCallbackFailureCommand)
    );
    expect(client.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          CallbackId: "CallbackId",
        },
      })
    );
  });

  it("should call correct API for sendCallbackHeartbeat", async () => {
    const apiClient = createDurableApiClient(() => client);

    await apiClient.sendCallbackHeartbeat({
      CallbackId: "CallbackId",
    });

    expect(client.send).toHaveBeenCalledWith(
      expect.any(SendDurableExecutionCallbackHeartbeatCommand)
    );
    expect(client.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          CallbackId: "CallbackId",
        },
      })
    );
  });
});
