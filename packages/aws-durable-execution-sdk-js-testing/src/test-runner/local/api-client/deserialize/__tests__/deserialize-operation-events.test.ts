import {
  deserializeCheckpointOperation,
  deserializeOperationEvent,
  deserializeOperationEvents,
} from "../deserialize-operation-events";
import {
  SerializedCheckpointOperation,
  SerializedOperationEvents,
} from "../../../../../checkpoint-server/types/operation-event";

describe("deserialize-operation-events", () => {
  describe("deserializeCheckpointOperation", () => {
    it("should deserialize checkpoint operation with timestamp conversions", () => {
      const serializedCheckpoint: SerializedCheckpointOperation = {
        update: {
          Id: "update-123",
          Type: "STEP",
          Payload: '{"data": "value"}',
          Action: "SUCCEED",
        },
        operation: {
          Id: "op-123",
          Name: "TestOperation",
          Type: "STEP",
          Status: "SUCCEEDED",
          StartTimestamp: 1609459200,
          EndTimestamp: 1609459300,
        },
        events: [
          {
            EventId: 1,
            EventTimestamp: 1609459200,
            EventType: "StepStarted",
            Id: "event-1",
          },
          {
            EventId: 2,
            EventTimestamp: 1609459300,
            EventType: "StepSucceeded",
            Id: "event-2",
          },
        ],
      };

      const result = deserializeCheckpointOperation(serializedCheckpoint);

      // Check update is preserved as-is (using _json)
      expect(result.update).toEqual({
        Id: "update-123",
        Type: "STEP",
        Payload: '{"data": "value"}',
        Action: "SUCCEED",
      });

      // Check operation timestamps are converted
      expect(result.operation.Id).toBe("op-123");
      expect(result.operation.StartTimestamp).toEqual(
        new Date(1609459200 * 1000),
      );
      expect(result.operation.EndTimestamp).toEqual(
        new Date(1609459300 * 1000),
      );

      // Check events array and timestamp conversions
      expect(result.events).toHaveLength(2);
      expect(result.events[0].EventId).toBe(1);
      expect(result.events[0].EventTimestamp).toEqual(
        new Date(1609459200 * 1000),
      );
      expect(result.events[1].EventId).toBe(2);
      expect(result.events[1].EventTimestamp).toEqual(
        new Date(1609459300 * 1000),
      );
    });

    it("should handle empty events array", () => {
      const serializedCheckpoint: SerializedCheckpointOperation = {
        update: {
          Id: "update-456",
          Type: "STEP",
          Action: "START",
        },
        operation: {
          Id: "op-456",
          Type: "STEP",
          Status: "STARTED",
          StartTimestamp: 1609459200,
        },
        events: [],
      };

      const result = deserializeCheckpointOperation(serializedCheckpoint);

      expect(result.update.Id).toBe("update-456");
      expect(result.operation.StartTimestamp).toEqual(
        new Date(1609459200 * 1000),
      );
      expect(result.events).toHaveLength(0);
    });
  });

  describe("deserializeOperationEvent", () => {
    it("should deserialize operation event with timestamp conversions", () => {
      const serializedOperationEvent: SerializedOperationEvents = {
        operation: {
          Id: "op-789",
          Type: "STEP",
          Status: "SUCCEEDED",
          StartTimestamp: 1609459200,
          EndTimestamp: 1609459300,
        },
        events: [
          {
            EventId: 1,
            EventTimestamp: 1609459250,
            EventType: "StepSucceeded",
            Id: "event-1",
          },
        ],
      };

      const result = deserializeOperationEvent(serializedOperationEvent);

      expect(result.operation.Id).toBe("op-789");
      expect(result.operation.StartTimestamp).toEqual(
        new Date(1609459200 * 1000),
      );
      expect(result.operation.EndTimestamp).toEqual(
        new Date(1609459300 * 1000),
      );
      expect(result.events).toHaveLength(1);
      expect(result.events[0].EventTimestamp).toEqual(
        new Date(1609459250 * 1000),
      );
    });
  });

  describe("deserializeOperationEvents", () => {
    it("should deserialize array of operation events", () => {
      const serializedOperationEvents: SerializedOperationEvents[] = [
        {
          operation: {
            Id: "op-1",
            Type: "STEP",
            Status: "SUCCEEDED",
            StartTimestamp: 1609459200,
          },
          events: [
            {
              EventId: 1,
              EventTimestamp: 1609459200,
              EventType: "StepStarted",
              Id: "event-1",
            },
          ],
        },
        {
          operation: {
            Id: "op-2",
            Type: "STEP",
            Status: "SUCCEEDED",
            StartTimestamp: 1609459300,
          },
          events: [
            {
              EventId: 2,
              EventTimestamp: 1609459300,
              EventType: "StepStarted",
              Id: "event-2",
            },
          ],
        },
      ];

      const result = deserializeOperationEvents(serializedOperationEvents);

      expect(result).toHaveLength(2);
      expect(result[0].operation.Id).toBe("op-1");
      expect(result[0].operation.StartTimestamp).toEqual(
        new Date(1609459200 * 1000),
      );
      expect(result[0].events[0].EventTimestamp).toEqual(
        new Date(1609459200 * 1000),
      );
      expect(result[1].operation.Id).toBe("op-2");
      expect(result[1].operation.StartTimestamp).toEqual(
        new Date(1609459300 * 1000),
      );
      expect(result[1].events[0].EventTimestamp).toEqual(
        new Date(1609459300 * 1000),
      );
    });

    it("should handle empty array", () => {
      const result = deserializeOperationEvents([]);

      expect(result).toHaveLength(0);
    });
  });
});
