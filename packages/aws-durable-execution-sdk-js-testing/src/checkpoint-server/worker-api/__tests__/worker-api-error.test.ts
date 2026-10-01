import { MessageChannel } from "node:worker_threads";
import { LambdaServiceException } from "@aws-sdk/client-lambda";
import {
  deserializeWorkerApiError,
  serializeWorkerApiError,
} from "../worker-api-error";

/** Sends a value through a real MessagePort, as the checkpoint worker does. */
const throughPort = (value: unknown): Promise<unknown> =>
  new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port2.once("message", (message: { value: unknown }) => {
      port1.close();
      port2.close();
      resolve(message.value);
    });
    port1.postMessage({ value });
  });

describe("worker API errors", () => {
  const serviceError = (): LambdaServiceException =>
    new LambdaServiceException({
      name: "ValidationException",
      $fault: "client",
      $metadata: { httpStatusCode: 400 },
      message: "1 validation error detected",
    });

  it("loses the name and $metadata of an error sent as is", async () => {
    // This is why the worker serializes its errors.
    const received = (await throughPort(serviceError())) as Error;

    expect(received.name).toBe("Error");
    expect((received as { $metadata?: unknown }).$metadata).toBeUndefined();
  });

  it("keeps the name, message, $fault, and $metadata across the port", async () => {
    const received = deserializeWorkerApiError(
      await throughPort(serializeWorkerApiError(serviceError())),
    );

    expect(received).toBeInstanceOf(Error);
    expect(received).toMatchObject({
      name: "ValidationException",
      message: "1 validation error detected",
      $fault: "client",
      $metadata: { httpStatusCode: 400 },
    });
  });

  it("leaves a value that is not an Error unchanged", () => {
    expect(serializeWorkerApiError("text")).toBe("text");
    expect(deserializeWorkerApiError("text")).toBe("text");
    expect(deserializeWorkerApiError({ kind: "other" })).toEqual({
      kind: "other",
    });
  });
});
