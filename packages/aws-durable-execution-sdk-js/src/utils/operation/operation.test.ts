import {
  LambdaClient,
  GetDurableExecutionStateCommand,
} from "@aws-sdk/client-lambda";
import type { Operation, ErrorObject } from "../../types/wire";
import { DurableOperationError } from "../../errors/durable-error/durable-error";
import { toOperationInfo } from "./operation";

const callback = (error?: ErrorObject): Operation => ({
  Id: "callback",
  StartTimestamp: new Date(0),
  Type: "CALLBACK",
  Status: "FAILED",
  CallbackDetails: { CallbackId: "callback-id", Error: error },
});

describe("operation plugin error metadata", () => {
  it.each([
    undefined,
    {},
    {
      ErrorType: undefined,
      ErrorMessage: undefined,
      ErrorData: undefined,
      StackTrace: undefined,
    },
  ])("does not invent an error from zero details (%j)", (error) => {
    const operation = callback(error);
    expect(toOperationInfo(operation).error).toBeUndefined();
    expect(operation.CallbackDetails?.Error).toBe(error);
    expect(toOperationInfo(operation)).toMatchObject({
      id: "callback",
      type: "CALLBACK",
      status: "FAILED",
    });
  });

  it.each([
    { ErrorType: "" },
    { ErrorMessage: "" },
    { ErrorData: "" },
    { StackTrace: [] },
    { ErrorData: "partial details" },
    {
      ErrorType: "ExternalError",
      ErrorMessage: "failure",
      ErrorData: "details",
      StackTrace: ["source:1"],
    },
    { FutureDetail: "preserve" },
    { FutureDetail: undefined },
  ])("retains provided error information (%j)", (error) => {
    const operation = callback(error as ErrorObject);
    expect(toOperationInfo(operation).error).toBeInstanceOf(
      DurableOperationError,
    );
    expect(operation.CallbackDetails?.Error).toBe(error);
  });

  it.each(["StepDetails", "ContextDetails", "ChainedInvokeDetails"] as const)(
    "does not invent error metadata for empty %s",
    (details) => {
      expect(
        toOperationInfo({
          Id: "operation",
          Type: "STEP",
          StartTimestamp: new Date(0),
          Status: "FAILED",
          [details]: { Error: {} },
        }).error,
      ).toBeUndefined();
    },
  );

  it("recognizes the actual Lambda client's empty error response", async () => {
    const client = new LambdaClient({
      region: "us-west-2",
      credentials: { accessKeyId: "local-test", secretAccessKey: "local-test" },
      requestHandler: {
        handle: async () => ({
          response: {
            statusCode: 200,
            headers: { "content-type": "application/json" },
            body: Buffer.from(
              JSON.stringify({
                Operations: [{ ...callback({}), StartTimestamp: 0 }],
              }),
            ),
          },
        }),
      },
    });
    try {
      const state = await client.send(
        new GetDurableExecutionStateCommand({
          DurableExecutionArn: "local-execution",
          CheckpointToken: "local-token",
        }),
      );
      expect(state.Operations?.[0].CallbackDetails?.Error).toEqual({});
      expect(Object.keys(state.Operations![0].CallbackDetails!.Error!)).toEqual(
        [],
      );
      expect(toOperationInfo(state.Operations![0]).error).toBeUndefined();
    } finally {
      client.destroy();
    }
  });
});
