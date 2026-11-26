/**
 * An AtLeastOnceAsync step does not wait for its SUCCEED checkpoint. These tests run the
 * whole withDurableExecution path with a slow fake client, to check that the SUCCEED is
 * still saved before the invocation reports an outcome, and in order with later updates.
 */
import { describe, it, expect } from "vitest";

import { withDurableExecution } from "../../with-durable-execution";
import { DurableExecutionInvocationInputWithClient } from "../../utils/durable-execution-invocation-input/durable-execution-invocation-input";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import {
  type DurableContext,
  type DurableExecutionClient,
  type DurableExecutionConfig,
  StepSemantics,
} from "../../types";
import {
  type CheckpointDurableExecutionRequest,
  type GetDurableExecutionStateResponse,
  OperationStatus,
  OperationType,
  type WireOperation,
} from "../../types/wire";
import type { Context } from "aws-lambda";

const lambdaContext = {
  awsRequestId: "request-1",
  getRemainingTimeInMillis: () => 300_000,
} as unknown as Context;

const freshExecutionState = (): WireOperation[] => [
  {
    Id: hashId("execution"),
    Type: OperationType.EXECUTION,
    Status: OperationStatus.STARTED,
    StartTimestamp: new Date().toISOString(),
    ExecutionDetails: { InputPayload: "{}" },
  } as unknown as WireOperation,
];

/** Records each update as TYPE:ACTION:NAME and answers after a delay. */
function slowRecordingClient(
  options: { failOnStepSucceed?: boolean; permanentFailure?: boolean } = {},
): {
  client: DurableExecutionClient;
  sent: string[];
} {
  const sent: string[] = [];
  const client: DurableExecutionClient = {
    getExecutionState: async (): Promise<GetDurableExecutionStateResponse> => ({
      Operations: [],
      NextMarker: undefined,
    }),
    checkpoint: async (params: CheckpointDurableExecutionRequest) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const updates = (params.Updates ?? []).map(
        (u) => `${u.Type}:${u.Action}:${u.Name ?? ""}`,
      );
      if (
        options.failOnStepSucceed &&
        updates.some((u) => u.startsWith("STEP:SUCCEED"))
      ) {
        throw options.permanentFailure
          ? Object.assign(new Error("Value failed to satisfy constraint"), {
              name: "ValidationException",
              $metadata: { httpStatusCode: 400 },
            })
          : Object.assign(new Error("Service Unavailable"), {
              name: "ServiceException",
              $metadata: { httpStatusCode: 503 },
            });
      }
      sent.push(...updates);
      return {
        CheckpointToken: `token-${sent.length}`,
        NewExecutionState: undefined,
      };
    },
  };
  return { client, sent };
}

const invoke = (
  client: DurableExecutionClient,
  handler: (event: unknown, context: DurableContext) => Promise<unknown>,
  config: DurableExecutionConfig = {},
): Promise<unknown> =>
  withDurableExecution(handler, {
    defaultStepSemantics: StepSemantics.AtLeastOnceAsync,
    ...config,
  })(
    new DurableExecutionInvocationInputWithClient(
      {
        DurableExecutionArn:
          "arn:aws:lambda:us-east-1:123456789012:function:repro:$LATEST",
        CheckpointToken: "token-0",
        InitialExecutionState: {
          Operations: freshExecutionState(),
          NextMarker: "",
        },
      },
      client,
    ),
    lambdaContext,
  );

describe("AtLeastOnceAsync through withDurableExecution", () => {
  it("saves the step's SUCCEED before the invocation reports SUCCEEDED", async () => {
    const { client, sent } = slowRecordingClient();

    const response = await invoke(client, async (_event, context) => {
      await context.step("a", async () => "done");
      return "finished";
    });

    expect(response).toMatchObject({ Status: "SUCCEEDED" });
    expect(sent).toContain("STEP:SUCCEED:a");
  });

  it("sends a child step's SUCCEED before the child context's SUCCEED", async () => {
    const { client, sent } = slowRecordingClient();

    await invoke(client, async (_event, context) => {
      await context.runInChildContext("child", async (child) =>
        child.step("inner", async () => "done"),
      );
      return "finished";
    });

    const stepSucceed = sent.indexOf("STEP:SUCCEED:inner");
    const contextSucceed = sent.indexOf("CONTEXT:SUCCEED:child");
    expect(stepSucceed).toBeGreaterThanOrEqual(0);
    expect(contextSucceed).toBeGreaterThan(stepSucceed);
  });

  it("does not report SUCCEEDED when the SUCCEED checkpoint fails", async () => {
    const { client } = slowRecordingClient({ failOnStepSucceed: true });

    const invocation = invoke(client, async (_event, context) => {
      await context.step("a", async () => "done");
      return "finished";
    });

    await expect(invocation).rejects.toThrow(/Checkpoint failed/);
  });

  it("rethrows a failed SUCCEED checkpoint when the handler throws first", async () => {
    const { client } = slowRecordingClient({ failOnStepSucceed: true });
    const events: string[] = [];

    const invocation = invoke(
      client,
      async (_event, context) => {
        await context.step("a", async () => "done");
        throw new Error("handler failed after the step");
      },
      {
        plugins: [
          {
            createPlugin: () => ({
              onInvocationEnd: async (info) => {
                // Async, so the test also checks that the SDK waits for it.
                await new Promise((resolve) => setTimeout(resolve, 10));
                events.push(`end:${info.status}`);
              },
            }),
          },
        ],
      },
    );

    // FAILED would end the execution without the step's result. The checkpoint error makes
    // Lambda retry the invocation instead.
    await expect(invocation).rejects.toThrow(/Checkpoint failed/);
    // Plugins hear RETRYING once, and before the invocation rejects.
    expect(events).toEqual(["end:RETRYING"]);
  });

  it("answers FAILED when the SUCCEED checkpoint fails for good after the handler throws", async () => {
    const { client } = slowRecordingClient({
      failOnStepSucceed: true,
      permanentFailure: true,
    });
    const events: string[] = [];

    const response = await invoke(
      client,
      async (_event, context) => {
        await context.step("a", async () => "done");
        throw new Error("handler failed after the step");
      },
      {
        plugins: [
          {
            createPlugin: () => ({
              onInvocationEnd: async (info) => {
                events.push(`end:${info.status}`);
              },
            }),
          },
        ],
      },
    );

    // A failure that ends the execution is not retried, so the invocation answers FAILED.
    expect(response).toMatchObject({ Status: "FAILED" });
    expect(events).toEqual(["end:FAILED"]);
  });
});
