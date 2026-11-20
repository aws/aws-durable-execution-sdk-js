import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
/**
 * Runs a distributed map beside a step through withDurableExecution, with a fake service that
 * moves the map operation from PENDING to STARTED to SUCCEEDED.
 *
 * The step keeps the invocation running, so the checkpoint manager polls instead of suspending.
 * The first poll reports STARTED. The map must keep waiting until a later poll reports SUCCEEDED.
 */

import { Context } from "aws-lambda";
import { withDurableExecution } from "../../with-durable-execution";
import { DurableExecutionInvocationInputWithClient } from "../../utils/durable-execution-invocation-input/durable-execution-invocation-input";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import {
  DurableContext,
  DurableExecutionClient,
  DistributedMapProcessor,
  DistributedMapStatus,
  DistributedMapSummary,
} from "../../types";
import {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateResponse,
  OperationAction,
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

/** A fresh execution: only the EXECUTION operation, so every operation starts for the first time. */
const freshExecutionState = (): WireOperation[] => [
  {
    Id: hashId("execution"),
    Type: OperationType.EXECUTION,
    Status: OperationStatus.STARTED,
    StartTimestamp: new Date().toISOString(),
    ExecutionDetails: { InputPayload: "{}" },
  } as unknown as WireOperation,
];

/**
 * A fake service that keeps an operation map. A DISTRIBUTED_MAP START records the map PENDING.
 * A step update records the step with the update's status. A request with no updates is a
 * poll: the first poll moves the map to STARTED, and the second moves it to SUCCEEDED.
 */
const fakeService = (): {
  client: DurableExecutionClient;
  polls: () => number;
} => {
  const operations = new Map<string, WireOperation>();
  let polls = 0;
  const setMapStatus = (status: OperationStatus): void => {
    for (const [id, op] of operations) {
      if (op.Type !== OperationType.DISTRIBUTED_MAP) continue;
      operations.set(id, {
        ...op,
        Status: status,
        ...(status === OperationStatus.SUCCEEDED
          ? {
              DistributedMapDetails: {
                DistributedMapRunArn: "arn:run",
                SourceExhausted: true,
                SuccessCount: 1,
                FailureCount: 0,
                ReadCount: 0,
                TotalCount: 1,
              },
            }
          : {}),
      } as WireOperation);
    }
  };
  const client: DurableExecutionClient = {
    getExecutionState: async (): Promise<GetDurableExecutionStateResponse> => ({
      Operations: [],
      NextMarker: undefined,
    }),
    checkpoint: async (
      request: CheckpointDurableExecutionRequest,
    ): Promise<CheckpointDurableExecutionResponse> => {
      const updates = request.Updates ?? [];
      if (updates.length === 0) {
        polls++;
        setMapStatus(
          polls === 1 ? OperationStatus.STARTED : OperationStatus.SUCCEEDED,
        );
      }
      for (const u of updates) {
        if (u.Type === OperationType.DISTRIBUTED_MAP) {
          operations.set(u.Id!, {
            Id: u.Id,
            ParentId: u.ParentId,
            Name: u.Name,
            Type: u.Type,
            SubType: u.SubType,
            Status: OperationStatus.PENDING,
            StartTimestamp: new Date().toISOString(),
          } as WireOperation);
        } else if (u.Type === OperationType.STEP) {
          operations.set(u.Id!, {
            Id: u.Id,
            ParentId: u.ParentId,
            Name: u.Name,
            Type: u.Type,
            SubType: u.SubType,
            Status:
              u.Action === OperationAction.SUCCEED
                ? OperationStatus.SUCCEEDED
                : OperationStatus.STARTED,
            StartTimestamp: new Date().toISOString(),
            ...(u.Action === OperationAction.SUCCEED
              ? { StepDetails: { Result: u.Payload } }
              : {}),
          } as WireOperation);
        }
      }
      return {
        CheckpointToken: `token-${polls}-${updates.length}`,
        NewExecutionState: { Operations: [...operations.values()] },
      } as CheckpointDurableExecutionResponse;
    },
  };
  return { client, polls: () => polls };
};

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

describe("Distributed map status changes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps waiting while a poll reports STARTED, then resolves on SUCCEEDED", async () => {
    const { client, polls } = fakeService();
    let summary: DistributedMapSummary | undefined;

    const invocation = invoke(client, async (_event, context) => {
      [summary] = await Promise.all([
        context.distributedMap("run", ["a"], processor, 1),
        context.step("work", async () => {
          await new Promise((r) => setTimeout(r, 5000));
          return "done";
        }),
      ]);
      return "finished";
    });

    let settled = false;
    invocation.finally(() => {
      settled = true;
    });
    for (let i = 0; i < 20 && !settled; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }

    await expect(invocation).resolves.toMatchObject({ Status: "SUCCEEDED" });
    expect(summary?.status).toBe(DistributedMapStatus.SUCCEEDED);
    expect(polls()).toBe(2);
  });
});
