import { vi, describe, it, expect } from "vitest";
/**
 * Runs the durable item handler wrapper through the real withDurableExecution and context.map.
 *
 * context.map wraps a failed item's error in a ChildContextError. The wrapper must still report
 * the error data of the error it wraps. The unit tests build that ChildContextError by hand, so
 * only running the real path shows that the pieces agree.
 */

import { Context } from "aws-lambda";
import { createDistributedMapItemHandlerWithDurableExecution } from "./distributed-map-helpers";
import { StepError } from "./errors/durable-error/durable-error";
import { DurableExecutionClient } from "./types";
import {
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateResponse,
  OperationStatus,
  OperationType,
  WireOperation,
} from "./types/wire";
import { DurableExecutionInvocationInputWithClient } from "./utils/durable-execution-invocation-input/durable-execution-invocation-input";
import { hashId } from "./utils/step-id-utils/step-id-utils";

vi.mock("./utils/logger/logger");

const lambdaContext = {
  awsRequestId: "request-1",
  getRemainingTimeInMillis: () => 300_000,
} as unknown as Context;

// A service that accepts every checkpoint. The execution is new, so every operation runs for the first time.
const client: DurableExecutionClient = {
  getExecutionState: async (): Promise<GetDurableExecutionStateResponse> => ({
    Operations: [],
    NextMarker: undefined,
  }),
  checkpoint: async (): Promise<CheckpointDurableExecutionResponse> =>
    ({
      CheckpointToken: "token-2",
      NewExecutionState: { Operations: [] },
    }) as CheckpointDurableExecutionResponse,
};

const RUN_ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:parent:$LATEST/durable-execution/e/i/distributed-map-run/run-1";

// Invokes a durable wrapper the way the service invokes a new processor execution.
async function run(
  handler: ReturnType<
    typeof createDistributedMapItemHandlerWithDurableExecution
  >,
  event: unknown,
): Promise<{
  Status: string;
  Result: string;
  Error?: { ErrorMessage?: string };
}> {
  return (await handler(
    new DurableExecutionInvocationInputWithClient(
      {
        DurableExecutionArn:
          "arn:aws:lambda:us-east-1:123456789012:function:proc:$LATEST",
        CheckpointToken: "token-1",
        InitialExecutionState: {
          Operations: [
            {
              Id: hashId("execution"),
              Type: OperationType.EXECUTION,
              Status: OperationStatus.STARTED,
              StartTimestamp: new Date().toISOString(),
              ExecutionDetails: { InputPayload: JSON.stringify(event) },
            } as unknown as WireOperation,
          ],
          NextMarker: "",
        },
      },
      client,
    ),
    lambdaContext,
  )) as { Status: string; Result: string; Error?: { ErrorMessage?: string } };
}

describe("Distributed map durable item handler composed tests", () => {
  it("reports the error data of a failed item's error", async () => {
    const handler = createDistributedMapItemHandlerWithDurableExecution<
      { id: string; ok: boolean },
      string
    >(async (_context, item) => {
      if (!item.ok) {
        throw new StepError("bad item", undefined, '{"id":"b"}');
      }
      return item.id;
    });

    const event = {
      distributedMapRunArn: RUN_ARN,
      records: [
        { itemId: "item-0", body: JSON.stringify({ id: "a", ok: true }) },
        { itemId: "item-1", body: JSON.stringify({ id: "b", ok: false }) },
      ],
    };
    const output = await run(handler, event);

    expect(output.Status).toBe("SUCCEEDED");
    expect(JSON.parse(output.Result)).toEqual({
      batchItemResults: [{ itemIdentifier: "item-0", output: '"a"' }],
      batchItemFailures: [
        {
          itemIdentifier: "item-1",
          error: {
            errorType: "ChildContextError",
            errorMessage: "bad item",
            errorData: '{"id":"b"}',
          },
        },
      ],
    });
  });

  it("passes each item its itemId and the run ARN through the real context.map", async () => {
    const handler = createDistributedMapItemHandlerWithDurableExecution<
      string,
      string
    >(
      async (_context, item, itemContext) =>
        `${item}:${itemContext.itemId}:${itemContext.distributedMapRunArn}`,
    );

    const output = await run(handler, {
      distributedMapRunArn: RUN_ARN,
      records: [
        { itemId: "item-0", body: '"a"' },
        { itemId: "item-1", body: '"b"' },
      ],
    });

    expect(output.Status).toBe("SUCCEEDED");
    expect(JSON.parse(output.Result).batchItemResults).toEqual([
      {
        itemIdentifier: "item-0",
        output: JSON.stringify(`a:item-0:${RUN_ARN}`),
      },
      {
        itemIdentifier: "item-1",
        output: JSON.stringify(`b:item-1:${RUN_ARN}`),
      },
    ]);
  });

  it("fails the execution for a malformed run ARN", async () => {
    const fn = vi.fn();
    const handler = createDistributedMapItemHandlerWithDurableExecution(fn);

    const output = await run(handler, {
      distributedMapRunArn: "arn:not-a-run",
      records: [{ itemId: "item-0", body: '"a"' }],
    });

    expect(output.Status).toBe("FAILED");
    expect(output.Error?.ErrorMessage).toMatch(/valid 'distributedMapRunArn'/);
    expect(fn).not.toHaveBeenCalled();
  });
});
