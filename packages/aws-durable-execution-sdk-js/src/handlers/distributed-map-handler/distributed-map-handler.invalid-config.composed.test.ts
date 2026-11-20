import { vi, describe, it, expect } from "vitest";
/**
 * Runs an invalid distributed map configuration through withDurableExecution, to show what the
 * invocation returns.
 *
 * An invalid configuration fails the same way on every retry. So both an error the SDK finds
 * and a rejection of the START checkpoint by the service end the execution FAILED, and customer
 * code cannot catch either one. An "Invalid checkpoint token" rejection is different: it fails
 * only the invocation, so the invocation throws and Lambda retries it.
 */

import { Context } from "aws-lambda";
import { withDurableExecution } from "../../with-durable-execution";
import { DurableExecutionInvocationInputWithClient } from "../../utils/durable-execution-invocation-input/durable-execution-invocation-input";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import {
  DurableContext,
  DurableExecutionClient,
  DistributedMapProcessor,
} from "../../types";
import {
  CheckpointDurableExecutionRequest,
  GetDurableExecutionStateResponse,
  OperationStatus,
  OperationType,
  WireOperation,
} from "../../types/wire";

vi.mock("../../utils/logger/logger");

const lambdaContext = {
  awsRequestId: "request-1",
  getRemainingTimeInMillis: () => 300_000,
} as unknown as Context;

const processor = DistributedMapProcessor.reportBatchOutcome("proc-fn");

/** A fresh execution: only the EXECUTION operation, so the map call is reached for the first time. */
const freshExecutionState = (): WireOperation[] => [
  {
    Id: hashId("execution"),
    Type: OperationType.EXECUTION,
    Status: OperationStatus.STARTED,
    StartTimestamp: new Date().toISOString(),
    ExecutionDetails: { InputPayload: "{}" },
  } as unknown as WireOperation,
];

/** A client whose checkpoint call runs `checkpoint`, and which records every request. */
const recordingClient = (
  checkpoint: (request: CheckpointDurableExecutionRequest) => Promise<never>,
): {
  client: DurableExecutionClient;
  requests: CheckpointDurableExecutionRequest[];
} => {
  const requests: CheckpointDurableExecutionRequest[] = [];
  const client: DurableExecutionClient = {
    getExecutionState: async (): Promise<GetDurableExecutionStateResponse> => ({
      Operations: [],
      NextMarker: undefined,
    }),
    checkpoint: async (request: CheckpointDurableExecutionRequest) => {
      requests.push(request);
      return checkpoint(request);
    },
  };
  return { client, requests };
};

/** An AWS-shaped InvalidParameterValueException, the shape CheckpointManager reads. */
const invalidParameterValue = (message: string): Error =>
  Object.assign(new Error(message), {
    name: "InvalidParameterValueException",
    $metadata: { httpStatusCode: 400 },
  });

const invoke = (
  client: DurableExecutionClient,
  handler: (event: unknown, context: DurableContext) => Promise<unknown>,
): Promise<unknown> =>
  withDurableExecution(handler)(
    new DurableExecutionInvocationInputWithClient(
      {
        DurableExecutionArn:
          "arn:aws:lambda:us-east-1:123456789012:function:repro:$LATEST",
        CheckpointToken: "token-1",
        InitialExecutionState: {
          Operations: freshExecutionState(),
          NextMarker: "",
        },
      },
      client,
    ),
    lambdaContext,
  );

/** Counts DISTRIBUTED_MAP updates across the recorded checkpoint requests. */
const distributedMapUpdates = (
  requests: CheckpointDurableExecutionRequest[],
): number =>
  requests
    .flatMap((r) => r.Updates ?? [])
    .filter((u) => u.Type === OperationType.DISTRIBUTED_MAP).length;

describe("Distributed map with an invalid configuration", () => {
  it("fails the execution when the SDK finds an invalid config before any await", async () => {
    const { client, requests } = recordingClient(async () => {
      throw new Error("checkpoint must not be called");
    });
    let caught = false;

    const result = await invoke(client, async (_event, context) => {
      try {
        await context.distributedMap(["a"], processor, 1, {
          completionConfig: {
            toleratedFailureCount: 1,
            toleratedFailurePercentage: 10,
          } as any,
        });
      } catch {
        caught = true;
      }
      return "finished";
    });

    expect(result).toMatchObject({
      Status: "FAILED",
      Error: { ErrorMessage: expect.stringMatching(/mutually exclusive/) },
    });
    expect(caught).toBe(false);
    expect(distributedMapUpdates(requests)).toBe(0);
  });

  it("fails the execution when the SDK finds an invalid config after an await", async () => {
    const { client, requests } = recordingClient(async () => {
      throw new Error("checkpoint must not be called");
    });
    let caught = false;

    const result = await invoke(client, async (_event, context) => {
      try {
        await context.distributedMap(
          [{ blob: "x".repeat(1_200_000) }],
          processor,
          1,
        );
      } catch {
        caught = true;
      }
      return "finished";
    });

    expect(result).toMatchObject({
      Status: "FAILED",
      Error: {
        ErrorMessage: expect.stringContaining("exceeds the 1 MB limit"),
      },
    });
    expect(caught).toBe(false);
    expect(distributedMapUpdates(requests)).toBe(0);
  });

  it("fails the execution with the service's message when the service rejects the START", async () => {
    const serviceMessage =
      "DistributedMapOptions.MaxConcurrency must be between 1 and 10000";
    const { client, requests } = recordingClient(async () => {
      throw invalidParameterValue(serviceMessage);
    });
    let caught = false;

    const result = await invoke(client, async (_event, context) => {
      try {
        await context.distributedMap(["a"], processor, 20_000);
      } catch {
        caught = true;
      }
      return "finished";
    });

    expect(result).toMatchObject({
      Status: "FAILED",
      Error: {
        ErrorType: "CheckpointUnrecoverableExecutionError",
        ErrorMessage: `[Unrecoverable Execution] Checkpoint failed: ${serviceMessage}`,
      },
    });
    expect(caught).toBe(false);
    expect(distributedMapUpdates(requests)).toBe(1);
  });

  it("throws from the invocation when the service rejects the START with Invalid checkpoint token", async () => {
    const { client } = recordingClient(async () => {
      throw invalidParameterValue("Invalid checkpoint token: token-1");
    });

    const invocation = invoke(client, async (_event, context) => {
      await context.distributedMap(["a"], processor, 1);
      return "finished";
    });

    await expect(invocation).rejects.toThrow(/Invalid checkpoint token/);
    await expect(invocation).rejects.toMatchObject({
      isUnrecoverableInvocation: true,
    });
  });
});
