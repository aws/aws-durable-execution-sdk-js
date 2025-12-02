import { EventType } from "@aws-sdk/client-lambda";
import { isClosedExecution } from "../process-terminal-event";

describe("isClosedExecution", () => {
  it.each([
    [
      {
        EventType: EventType.ExecutionFailed,
      },
      true,
    ],
    [
      {
        EventType: EventType.ExecutionStopped,
      },
      true,
    ],
    [
      {
        EventType: EventType.ExecutionSucceeded,
      },
      true,
    ],
    [
      {
        EventType: EventType.ExecutionTimedOut,
      },
      true,
    ],
    [
      {
        EventType: EventType.CallbackStarted,
      },
      false,
    ],
    [
      {
        EventType: EventType.StepFailed,
      },
      false,
    ],
    [undefined, false],
    [{}, false],
  ])("should return %s when status is $.EventType", (event, expected) => {
    const result = isClosedExecution(event);
    expect(result).toBe(expected);
  });
});
