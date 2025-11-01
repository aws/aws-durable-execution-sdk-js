import { deserializeEvent } from "../deserialize-event";
import { SerializedEvent } from "../../../../../checkpoint-server/types/operation-event";

describe("deserializeEvent", () => {
  it("should deserialize basic event fields and convert EventTimestamp", () => {
    const serializedEvent: SerializedEvent = {
      EventId: 1,
      EventTimestamp: 1609459200,
      EventType: "ExecutionStarted",
      Id: "event-123",
      Name: "TestEvent",
    };

    const result = deserializeEvent(serializedEvent);

    expect(result.EventId).toBe(1);
    expect(result.EventTimestamp).toEqual(new Date(1609459200 * 1000));
    expect(result.EventType).toBe("ExecutionStarted");
    expect(result.Id).toBe("event-123");
    expect(result.Name).toBe("TestEvent");
  });

  it("should deserialize InvocationCompletedDetails with timestamp conversion", () => {
    const serializedEvent: SerializedEvent = {
      EventId: 2,
      EventTimestamp: 1609459200,
      EventType: "InvocationCompleted",
      Id: "event-inv",
      InvocationCompletedDetails: {
        StartTimestamp: 1609459100,
        EndTimestamp: 1609459200,
        RequestId: "req-123",
      },
    };

    const result = deserializeEvent(serializedEvent);

    expect(result.InvocationCompletedDetails?.StartTimestamp).toEqual(
      new Date(1609459100 * 1000),
    );
    expect(result.InvocationCompletedDetails?.EndTimestamp).toEqual(
      new Date(1609459200 * 1000),
    );
    expect(result.InvocationCompletedDetails?.RequestId).toBe("req-123");
  });

  it("should deserialize WaitStartedDetails with ScheduledEndTimestamp conversion", () => {
    const serializedEvent: SerializedEvent = {
      EventId: 3,
      EventTimestamp: 1609459200,
      EventType: "WaitStarted",
      Id: "event-wait",
      WaitStartedDetails: {
        Duration: 3600,
        ScheduledEndTimestamp: 1609462800,
      },
    };

    const result = deserializeEvent(serializedEvent);

    expect(result.WaitStartedDetails?.Duration).toBe(3600);
    expect(result.WaitStartedDetails?.ScheduledEndTimestamp).toEqual(
      new Date(1609462800 * 1000),
    );
  });

  it("should deserialize event with nested detail objects", () => {
    const serializedEvent: SerializedEvent = {
      EventId: 4,
      EventTimestamp: 1609459200,
      EventType: "StepSucceeded",
      Id: "event-step",
      StepSucceededDetails: {
        Result: {
          Payload: '{"result": "success"}',
        },
        RetryDetails: {
          CurrentAttempt: 1,
        },
      },
    };

    const result = deserializeEvent(serializedEvent);

    expect(result.StepSucceededDetails).toBeDefined();
    expect(result.StepSucceededDetails?.Result?.Payload).toBe(
      '{"result": "success"}',
    );
    expect(result.StepSucceededDetails?.RetryDetails?.CurrentAttempt).toBe(1);
  });

  it("should handle optional fields", () => {
    const serializedEvent: SerializedEvent = {
      EventId: 5,
      EventTimestamp: 1609459200,
      EventType: "StepStarted",
      Id: "minimal-event",
    };

    const result = deserializeEvent(serializedEvent);

    expect(result.EventId).toBe(5);
    expect(result.EventTimestamp).toEqual(new Date(1609459200 * 1000));
    expect(result.Name).toBeUndefined();
    expect(result.ParentId).toBeUndefined();
  });
});
