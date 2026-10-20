import {
  Event,
  EventType,
  GetDurableExecutionHistoryCommand,
  InvocationType,
  InvokeCommand,
  LambdaClient,
} from "@aws-sdk/client-lambda";
import { OperationSubType } from "@aws/durable-execution-sdk-js";
import { CloudDurableTestRunner } from "../cloud-durable-test-runner";
import { WaitingOperationStatus } from "../../types/durable-operation";

describe("CloudDurableTestRunner history notifications", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it.each([false, true])(
    "resolves SUBMITTED from the first history batch (execution complete: %s)",
    async (completeInFirstBatch) => {
      const executionArn =
        "arn:aws:lambda:us-east-1:123456789012:execution:test";
      const timestamp = new Date("2026-01-01T00:00:00Z");
      const events: Event[] = [
        {
          Id: "execution",
          EventId: 1,
          EventTimestamp: timestamp,
          EventType: EventType.ExecutionStarted,
          ExecutionStartedDetails: {
            Input: { Payload: "{}" },
            ExecutionTimeout: 60,
          },
        },
        {
          Id: "approval",
          Name: "approval",
          SubType: OperationSubType.WAIT_FOR_CALLBACK,
          EventId: 2,
          EventTimestamp: timestamp,
          EventType: EventType.ContextStarted,
          ContextStartedDetails: {},
        },
        {
          Id: "callback",
          ParentId: "approval",
          EventId: 3,
          EventTimestamp: timestamp,
          EventType: EventType.CallbackStarted,
          CallbackStartedDetails: { CallbackId: "callback-token" },
        },
        {
          Id: "submitter",
          ParentId: "approval",
          EventId: 4,
          EventTimestamp: timestamp,
          EventType: EventType.StepStarted,
          StepStartedDetails: {},
        },
        {
          Id: "submitter",
          ParentId: "approval",
          EventId: 5,
          EventTimestamp: timestamp,
          EventType: EventType.StepSucceeded,
          StepSucceededDetails: {
            Result: { Payload: "null" },
            RetryDetails: {},
          },
        },
      ];
      const completion: Event[] = [
        {
          Id: "callback",
          ParentId: "approval",
          EventId: 6,
          EventTimestamp: timestamp,
          EventType: EventType.CallbackSucceeded,
          CallbackSucceededDetails: { Result: { Payload: '"approved"' } },
        },
        {
          Id: "approval",
          EventId: 7,
          EventTimestamp: timestamp,
          EventType: EventType.ContextSucceeded,
          ContextSucceededDetails: { Result: { Payload: '"approved"' } },
        },
        {
          Id: "execution",
          EventId: 8,
          EventTimestamp: timestamp,
          EventType: EventType.ExecutionSucceeded,
          ExecutionSucceededDetails: { Result: { Payload: '"done"' } },
        },
      ];
      let complete = completeInFirstBatch;
      const getHistory = jest.fn(async () => ({
        $metadata: {},
        Events: complete ? [...events, ...completion] : events,
      }));
      const client = new LambdaClient({ region: "us-east-1" });
      jest.spyOn(client, "send").mockImplementation(async (command) => {
        if (command instanceof InvokeCommand) {
          return { DurableExecutionArn: executionArn, $metadata: {} };
        }
        if (command instanceof GetDurableExecutionHistoryCommand) {
          return getHistory();
        }
        throw new Error("Unexpected service request");
      });
      const runner = new CloudDurableTestRunner({
        functionName: "test-function:1",
        client,
        config: { invocationType: InvocationType.Event, pollInterval: 1000 },
      });
      const execution = runner.run();
      const operation = runner.getOperation("approval");
      let outcome: object = { state: "waiting" };
      const submitted = operation
        .waitForData(WaitingOperationStatus.SUBMITTED)
        .then(
          () => {
            outcome = {
              state: "submitted",
              callbackId: operation.getCallbackDetails()?.callbackId,
            };
          },
          (error: unknown) => {
            outcome = { state: "rejected", error };
          },
        );
      try {
        // No second history response is available to rescue a missed notification.
        await jest.advanceTimersByTimeAsync(1000);
        expect(getHistory).toHaveBeenCalledTimes(1);
        expect(outcome).toEqual({
          state: "submitted",
          callbackId: "callback-token",
        });
      } finally {
        complete = true;
        await jest.advanceTimersByTimeAsync(1000);
        await execution;
        await submitted;
        client.destroy();
      }
    },
  );
});
