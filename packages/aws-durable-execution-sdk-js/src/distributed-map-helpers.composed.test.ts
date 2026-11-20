import { vi, describe, it, expect, beforeEach } from "vitest";
/**
 * Runs the durable item helper through the real withDurableExecution and context.map.
 *
 * context.map wraps a failed item's error in a ChildContextError. The helper must still report
 * the error data of the error it wraps. The unit tests build that ChildContextError by hand, so
 * only running the real path shows that the pieces agree.
 */

import { Context } from "aws-lambda";
import {
  processDistributedMapBatch,
  processDistributedMapItems,
  DistributedMapProcessorEvent,
} from "./distributed-map-helpers";
import { withDurableExecution } from "./with-durable-execution";
import { StepError } from "./errors/durable-error/durable-error";
import {
  DistributedMapItemContext,
  DurableContext,
  DurableExecutionClient,
  NestingType,
} from "./types";
import {
  CheckpointDurableExecutionRequest,
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

// The operation updates every checkpoint carried, in order.
type RecordedUpdate = { Type?: string; Name?: string; Action?: string };
const recorded: RecordedUpdate[] = [];

// A service that accepts every checkpoint. The execution is new, so every operation runs for the first time.
const client: DurableExecutionClient = {
  getExecutionState: async (): Promise<GetDurableExecutionStateResponse> => ({
    Operations: [],
    NextMarker: undefined,
  }),
  checkpoint: async (
    request: CheckpointDurableExecutionRequest,
  ): Promise<CheckpointDurableExecutionResponse> => {
    recorded.push(...((request.Updates ?? []) as RecordedUpdate[]));
    return {
      CheckpointToken: "token-2",
      NewExecutionState: { Operations: [] },
    } as CheckpointDurableExecutionResponse;
  },
};

const RUN_ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:parent:$LATEST/durable-execution/e/i/distributed-map-run/run-1";

// Invokes a durable handler the way the service invokes a new processor execution.
async function run(
  handler: ReturnType<typeof withDurableExecution>,
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

// A durable handler that runs the items with the durable item helper.
function itemsHandler<TItem, TOutput>(
  fn: (
    context: DurableContext,
    item: TItem,
    itemContext: DistributedMapItemContext,
  ) => TOutput | Promise<TOutput>,
  opts?: { nesting?: NestingType },
) {
  return withDurableExecution(
    async (event: DistributedMapProcessorEvent, ctx) =>
      processDistributedMapItems<TItem, TOutput>(ctx, event, fn as never, opts),
  );
}

describe("Distributed map durable item helper composed tests", () => {
  beforeEach(() => {
    recorded.length = 0;
  });

  it("reports the error data of a failed item's error", async () => {
    const handler = itemsHandler<{ id: string; ok: boolean }, string>(
      async (_context, item) => {
        if (!item.ok) {
          throw new StepError("bad item", undefined, '{"id":"b"}');
        }
        return item.id;
      },
    );

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
    const handler = itemsHandler<string, string>(
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
    const handler = itemsHandler(fn);

    const output = await run(handler, {
      distributedMapRunArn: "arn:not-a-run",
      records: [{ itemId: "item-0", body: '"a"' }],
    });

    expect(output.Status).toBe("FAILED");
    expect(output.Error?.ErrorMessage).toMatch(/valid 'distributedMapRunArn'/);
    expect(fn).not.toHaveBeenCalled();
  });
  const twoItems = {
    distributedMapRunArn: RUN_ARN,
    records: [
      { itemId: "item-0", body: '"a"' },
      { itemId: "item-1", body: '"b"' },
    ],
  };
  const contextStarts = (): number =>
    recorded.filter((u) => u.Type === "CONTEXT" && u.Action === "START").length;

  it("runs each item in the invoking context by default, recording no CONTEXT operation per item", async () => {
    const output = await run(
      itemsHandler<string, string>((_c, item) => item),
      twoItems,
    );

    expect(output.Status).toBe("SUCCEEDED");
    const flat = contextStarts();

    recorded.length = 0;
    const nested = await run(
      itemsHandler<string, string>((_c, item) => item, {
        nesting: NestingType.NESTED,
      }),
      twoItems,
    );

    expect(nested.Status).toBe("SUCCEEDED");
    // NESTED records one CONTEXT operation for each of the two items. FLAT records none.
    expect(contextStarts() - flat).toBe(2);
  });

  it("runs a step before the items in the same durable handler", async () => {
    const handler = withDurableExecution(
      async (event: DistributedMapProcessorEvent, ctx) => {
        const prefix = await ctx.step("load-prefix", async () => "p-");
        return processDistributedMapItems<string, string>(
          ctx,
          event,
          async (itemCtx, item) =>
            await itemCtx.step("tag", async () => `${prefix}${item}`),
        );
      },
    );

    const output = await run(handler, twoItems);

    expect(output.Status).toBe("SUCCEEDED");
    expect(JSON.parse(output.Result).batchItemResults).toEqual([
      { itemIdentifier: "item-0", output: '"p-a"' },
      { itemIdentifier: "item-1", output: '"p-b"' },
    ]);
    expect(recorded.some((u) => u.Name === "load-prefix")).toBe(true);
  });

  it("runs the batch helper inside withDurableExecution", async () => {
    const seen: string[] = [];
    const handler = withDurableExecution(
      async (event: DistributedMapProcessorEvent, ctx) => {
        await processDistributedMapBatch<string>(event, async (items) => {
          await ctx.step("write", async () => {
            seen.push(...items);
          });
        });
      },
    );

    const output = await run(handler, twoItems);

    expect(output.Status).toBe("SUCCEEDED");
    expect(seen).toEqual(["a", "b"]);
    expect(recorded.some((u) => u.Name === "write")).toBe(true);
  });
});
