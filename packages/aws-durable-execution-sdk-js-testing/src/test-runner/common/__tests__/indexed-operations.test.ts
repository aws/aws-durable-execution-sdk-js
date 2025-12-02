import {
  Operation,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { IndexedOperations } from "../indexed-operations";
import { OperationEvents } from "../operations/operation-with-data";

describe("IndexedOperations", () => {
  // Sample operations for testing
  const sampleOperations = [
    {
      operation: {
        Id: "op1",
        Name: "operation1",
        Status: OperationStatus.SUCCEEDED,
        StartTimestamp: new Date(),
        Type: OperationType.STEP,
      },
      events: [
        {
          EventId: 1,
        },
      ],
    },
    {
      operation: {
        Id: "op2",
        Name: "operation2",
        Status: OperationStatus.SUCCEEDED,
        StartTimestamp: new Date(),
        Type: OperationType.STEP,
      },
      events: [
        {
          EventId: 2,
        },
      ],
    },
    {
      operation: {
        Id: "op3",
        Name: "operation1", // Same name as first operation
        Status: OperationStatus.FAILED,
        StartTimestamp: new Date(),
        Type: OperationType.STEP,
      },
      events: [
        {
          EventId: 3,
        },
      ],
    },
  ];

  describe("constructor", () => {
    it("should initialize with provided operations", () => {
      const indexed = new IndexedOperations(sampleOperations);

      expect(indexed.getOperations()).toHaveLength(sampleOperations.length);
    });

    it("should initialize with empty array", () => {
      const indexed = new IndexedOperations([]);

      expect(indexed.getOperations()).toHaveLength(0);
    });
  });

  describe("addHistoryEvent", () => {
    it("should add all events when adding new operations", () => {
      const indexed = new IndexedOperations([]);

      const operations = [
        {
          operation: {
            Id: "op1",
            Name: "operation1",
            Status: OperationStatus.STARTED,
            StartTimestamp: new Date(),
            Type: OperationType.STEP,
          },
          events: [{ EventId: 1 }, { EventId: 2 }],
        },
        {
          operation: {
            Id: "op2",
            Name: "operation2",
            Status: OperationStatus.SUCCEEDED,
            StartTimestamp: new Date(),
            Type: OperationType.STEP,
          },
          events: [{ EventId: 3 }, { EventId: 4 }],
        },
      ];

      indexed.addOperations(operations);
      const historyEvents = indexed.getHistoryEvents();

      indexed.addHistoryEvent({
        EventId: 5,
      });

      expect(historyEvents).toHaveLength(5);
      expect(historyEvents.map((e) => e.EventId)).toEqual([1, 2, 3, 4, 5]);
    });

    it("should add history event correctly", () => {
      const indexed = new IndexedOperations([]);
      indexed.addHistoryEvent({
        EventId: 1,
      });

      expect(indexed.getHistoryEvents()).toHaveLength(1);
    });
  });

  describe("addOperations", () => {
    it("should add operations to the collection", () => {
      const indexed = new IndexedOperations([]);
      indexed.addOperations(sampleOperations);

      expect(indexed.getOperations()).toHaveLength(sampleOperations.length);
    });

    it("should replace existing operations with same ID instead of creating duplicates", () => {
      const indexed = new IndexedOperations([]);

      // Add initial operation
      const initialOperation: Operation = {
        Id: "op1",
        Name: "operation1",
        Status: OperationStatus.STARTED,
        Type: undefined,
        StartTimestamp: undefined,
      };
      indexed.addOperations([
        {
          operation: initialOperation,
          events: [],
        },
      ]);

      // Verify initial state
      expect(indexed.getOperations()).toHaveLength(1);
      expect(indexed.getById("op1")?.operation.Status).toBe(
        OperationStatus.STARTED,
      );

      // Add operation with same ID but different properties
      const updatedOperation: Operation = {
        Id: "op1",
        Name: "operation1-updated",
        Status: OperationStatus.SUCCEEDED,
        Type: undefined,
        StartTimestamp: undefined,
      };
      indexed.addOperations([
        {
          operation: updatedOperation,
          events: [],
        },
      ]);

      // Should have same length (no duplicates created)
      expect(indexed.getOperations()).toHaveLength(1);

      // Should retrieve the updated operation by ID
      const retrievedById = indexed.getById("op1");
      expect(retrievedById?.operation.Status).toBe(OperationStatus.SUCCEEDED);
      expect(retrievedById?.operation.Name).toBe("operation1-updated");

      // Should also be accessible by index and return the updated operation
      const retrievedByIndex = indexed.getByIndex(0);
      expect(retrievedByIndex?.operation.Status).toBe(
        OperationStatus.SUCCEEDED,
      );
      expect(retrievedByIndex?.operation.Name).toBe("operation1-updated");
    });

    it("should handle multiple operations with same ID by keeping the last one", () => {
      const indexed = new IndexedOperations([]);

      const operations: OperationEvents[] = [
        {
          operation: {
            Id: "op1",
            Name: "operation1",
            Status: OperationStatus.STARTED,
            Type: undefined,
            StartTimestamp: undefined,
          },
          events: [],
        },
        {
          operation: {
            Id: "op2",
            Name: "operation2",
            Status: OperationStatus.STARTED,
            Type: undefined,
            StartTimestamp: undefined,
          },
          events: [],
        },
        {
          operation: {
            Id: "op1",
            Name: "operation1-updated",
            Status: OperationStatus.SUCCEEDED,
            Type: undefined,
            StartTimestamp: undefined,
          },
          events: [],
        }, // Same ID as first operation
      ];

      indexed.addOperations(operations);

      // Should have 2 unique operations (op1 and op2)
      expect(indexed.getOperations()).toHaveLength(2);

      // op1 should have the values from the last operation with that ID
      const op1 = indexed.getById("op1");
      expect(op1?.operation.Status).toBe(OperationStatus.SUCCEEDED);
      expect(op1?.operation.Name).toBe("operation1-updated");

      // op2 should remain unchanged
      const op2 = indexed.getById("op2");
      expect(op2?.operation.Status).toBe(OperationStatus.STARTED);
      expect(op2?.operation.Name).toBe("operation2");
    });

    it("should update name index when operation with same ID has different name", () => {
      const indexed = new IndexedOperations([]);

      // Add initial operation
      const initialOperation: OperationEvents = {
        operation: {
          Id: "op1",
          Name: "original-name",
          Status: OperationStatus.STARTED,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      };
      indexed.addOperations([initialOperation]);

      // Verify it can be found by original name
      expect(indexed.getByNameAndIndex("original-name", 0)).toBeDefined();
      expect(indexed.getByNameAndIndex("original-name", 0)?.operation.Id).toBe(
        "op1",
      );

      // Add operation with same ID but different name
      const updatedOperation: OperationEvents = {
        operation: {
          Id: "op1",
          Name: "updated-name",
          Status: OperationStatus.SUCCEEDED,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      };
      indexed.addOperations([updatedOperation]);

      // Should be accessible by new name
      expect(indexed.getByNameAndIndex("updated-name", 0)).toBeDefined();
      expect(indexed.getByNameAndIndex("updated-name", 0)?.operation.Id).toBe(
        "op1",
      );
      expect(
        indexed.getByNameAndIndex("updated-name", 0)?.operation.Status,
      ).toBe(OperationStatus.SUCCEEDED);

      // Should still be accessible by original name (since the name index contains both entries)
      expect(indexed.getByNameAndIndex("original-name", 0)).toBeDefined();
      expect(indexed.getByNameAndIndex("original-name", 0)?.operation.Id).toBe(
        "op1",
      );
    });

    it("should generate operations array dynamically from operationsById map", () => {
      const indexed = new IndexedOperations([]);

      // Add some operations
      const operations: OperationEvents[] = [
        {
          operation: {
            Id: "op1",
            Name: "operation1",
            Status: OperationStatus.STARTED,
            Type: undefined,
            StartTimestamp: undefined,
          },
          events: [],
        },
        {
          operation: {
            Id: "op2",
            Name: "operation2",
            Status: OperationStatus.SUCCEEDED,
            Type: undefined,
            StartTimestamp: undefined,
          },
          events: [],
        },
      ];

      indexed.addOperations(operations);

      // Verify we can get all operations
      const allOperations = indexed.getOperations();
      expect(allOperations).toHaveLength(2);

      // Verify each operation can be found
      expect(
        allOperations.find((op) => op.operation.Id === "op1"),
      ).toBeDefined();
      expect(
        allOperations.find((op) => op.operation.Id === "op2"),
      ).toBeDefined();

      // Add an operation with same ID as existing one
      const updatedOp1: OperationEvents = {
        operation: {
          Id: "op1",
          Name: "operation1-updated",
          Status: OperationStatus.SUCCEEDED,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      };

      indexed.addOperations([updatedOp1]);

      // Should still have 2 operations total, but op1 should be updated
      const updatedOperations = indexed.getOperations();
      expect(updatedOperations).toHaveLength(2);

      const foundOp1 = updatedOperations.find(
        (op) => op.operation.Id === "op1",
      );
      expect(foundOp1?.operation.Name).toBe("operation1-updated");
      expect(foundOp1?.operation.Status).toBe(OperationStatus.SUCCEEDED);
    });

    it("should not handle operations without id", () => {
      const indexed = new IndexedOperations([]);
      const operationWithoutId: Operation = {
        Status: OperationStatus.STARTED,
        Name: "my-operation-name",
        Id: undefined,
        Type: undefined,
        StartTimestamp: undefined,
      };

      // Add the operation
      expect(() => {
        indexed.addOperations([
          {
            operation: operationWithoutId,
            events: [],
          },
        ]);
      }).toThrow("Cannot add operation without an ID");
    });

    it("should handle operations with empty string id", () => {
      const indexed = new IndexedOperations([]);
      const operationWithEmptyId: OperationEvents = {
        operation: {
          Id: "",
          Name: undefined,
          Status: OperationStatus.SUCCEEDED,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      };

      indexed.addOperations([operationWithEmptyId]);

      expect(indexed.getOperations()).toHaveLength(1);
      expect(indexed.getById("")).toBe(operationWithEmptyId);
    });

    it("should handle operations with empty string name", () => {
      const indexed = new IndexedOperations([]);
      const operationWithEmptyName: OperationEvents = {
        operation: {
          Id: "test-op",
          Name: "",
          Status: OperationStatus.SUCCEEDED,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      };

      indexed.addOperations([operationWithEmptyName]);

      expect(indexed.getOperations()).toHaveLength(1);
      expect(indexed.getByNameAndIndex("", 0)).toBe(operationWithEmptyName);
    });
  });

  describe("getHistoryEvents", () => {
    it("should return history events", () => {
      const indexed = new IndexedOperations(sampleOperations);
      const historyEvents = indexed.getHistoryEvents();

      expect(historyEvents).toHaveLength(3);
    });

    it("should return empty list if no operations exist", () => {
      const indexed = new IndexedOperations([]);
      const historyEvents = indexed.getHistoryEvents();

      expect(historyEvents).toHaveLength(0);
    });

    describe("previousHistoryIndex filtering", () => {
      it("should add all events when adding new operations", () => {
        const indexed = new IndexedOperations([]);

        const operations: OperationEvents[] = [
          {
            operation: {
              Id: "op1",
              Name: "operation1",
              Status: OperationStatus.STARTED,
              Type: undefined,
              StartTimestamp: undefined,
            },
            events: [{ EventId: 1 }, { EventId: 2 }],
          },
          {
            operation: {
              Id: "op2",
              Name: "operation2",
              Status: OperationStatus.SUCCEEDED,
              Type: undefined,
              StartTimestamp: undefined,
            },
            events: [{ EventId: 3 }, { EventId: 4 }],
          },
        ];

        indexed.addOperations(operations);
        const historyEvents = indexed.getHistoryEvents();

        expect(historyEvents).toHaveLength(4);
        expect(historyEvents.map((e) => e.EventId)).toEqual([1, 2, 3, 4]);
      });

      it("should only add new events when updating existing operations with additional events", () => {
        const indexed = new IndexedOperations([]);

        // Add initial operation with 2 events
        const initialOperation: OperationEvents = {
          operation: {
            Id: "op1",
            Name: "operation1",
            Status: OperationStatus.STARTED,
            Type: undefined,
            StartTimestamp: undefined,
          },
          events: [{ EventId: 1 }, { EventId: 2 }],
        };

        indexed.addOperations([initialOperation]);
        let historyEvents = indexed.getHistoryEvents();
        expect(historyEvents).toHaveLength(2);
        expect(historyEvents.map((e) => e.EventId)).toEqual([1, 2]);

        // Update same operation with 2 additional events (4 total)
        const updatedOperation: OperationEvents = {
          operation: {
            Id: "op1", // Same ID
            Name: "operation1",
            Status: OperationStatus.SUCCEEDED,
            Type: undefined,
            StartTimestamp: undefined,
          },
          events: [
            { EventId: 1 }, // Existing
            { EventId: 2 }, // Existing
            { EventId: 3 }, // New
            { EventId: 4 }, // New
          ],
        };

        indexed.addOperations([updatedOperation]);
        historyEvents = indexed.getHistoryEvents();

        // Should now have 4 events total (original 2 + new 2)
        expect(historyEvents).toHaveLength(4);
        expect(historyEvents.map((e) => e.EventId)).toEqual([1, 2, 3, 4]);
      });

      it("should not add duplicate events when updating operation with same events", () => {
        const indexed = new IndexedOperations([]);

        const operation: OperationEvents = {
          operation: {
            Id: "op1",
            Name: "operation1",
            Status: OperationStatus.STARTED,
            Type: undefined,
            StartTimestamp: undefined,
          },
          events: [{ EventId: 1 }, { EventId: 2 }],
        };

        // Add operation twice
        indexed.addOperations([operation]);
        indexed.addOperations([operation]);

        const historyEvents = indexed.getHistoryEvents();

        // Should only have 2 events, not 4
        expect(historyEvents).toHaveLength(2);
        expect(historyEvents.map((e) => e.EventId)).toEqual([1, 2]);
      });

      it("should handle operations with no events", () => {
        const indexed = new IndexedOperations([]);

        const operationWithoutEvents: OperationEvents = {
          operation: {
            Id: "op1",
            Name: "operation1",
            Status: OperationStatus.STARTED,
            Type: undefined,
            StartTimestamp: undefined,
          },
          events: [],
        };

        indexed.addOperations([operationWithoutEvents]);
        let historyEvents = indexed.getHistoryEvents();
        expect(historyEvents).toHaveLength(0);

        // Update with events
        const operationWithEvents: OperationEvents = {
          operation: {
            Id: "op1",
            Name: "operation1",
            Status: OperationStatus.SUCCEEDED,
            Type: undefined,
            StartTimestamp: undefined,
          },
          events: [{ EventId: 1 }],
        };

        indexed.addOperations([operationWithEvents]);
        historyEvents = indexed.getHistoryEvents();
        expect(historyEvents).toHaveLength(1);
        expect(historyEvents[0].EventId).toBe(1);
      });

      it("should handle multiple operations being updated with different event counts", () => {
        const indexed = new IndexedOperations([]);

        // Initial operations
        const initialOperations: OperationEvents[] = [
          {
            operation: {
              Id: "op1",
              Name: "operation1",
              Status: OperationStatus.STARTED,
              Type: undefined,
              StartTimestamp: undefined,
            },
            events: [{ EventId: 1 }],
          },
          {
            operation: {
              Id: "op2",
              Name: "operation2",
              Status: OperationStatus.STARTED,
              Type: undefined,
              StartTimestamp: undefined,
            },
            events: [{ EventId: 2 }, { EventId: 3 }],
          },
        ];

        indexed.addOperations(initialOperations);
        let historyEvents = indexed.getHistoryEvents();
        expect(historyEvents).toHaveLength(3);

        // Update both operations with additional events
        const updatedOperations: OperationEvents[] = [
          {
            operation: {
              Id: "op1",
              Name: "operation1",
              Status: OperationStatus.SUCCEEDED,
              Type: undefined,
              StartTimestamp: undefined,
            },
            events: [
              { EventId: 1 }, // Existing
              { EventId: 4 }, // New
            ],
          },
          {
            operation: {
              Id: "op2",
              Name: "operation2",
              Status: OperationStatus.SUCCEEDED,
              Type: undefined,
              StartTimestamp: undefined,
            },
            events: [
              { EventId: 2 }, // Existing
              { EventId: 3 }, // Existing
              { EventId: 5 }, // New
              { EventId: 6 }, // New
            ],
          },
        ];

        indexed.addOperations(updatedOperations);
        historyEvents = indexed.getHistoryEvents();

        // Should have original 3 + 1 new from op1 + 2 new from op2 = 6 total
        expect(historyEvents).toHaveLength(6);
        expect(historyEvents.map((e) => e.EventId)).toEqual([1, 2, 3, 4, 5, 6]);
      });

      it("should preserve event order when adding operations sequentially", () => {
        const indexed = new IndexedOperations([]);

        // Add first operation
        indexed.addOperations([
          {
            operation: {
              Id: "op1",
              Name: "operation1",
              Status: OperationStatus.STARTED,
              Type: undefined,
              StartTimestamp: undefined,
            },
            events: [{ EventId: 1 }],
          },
        ]);

        // Add second operation
        indexed.addOperations([
          {
            operation: {
              Id: "op2",
              Name: "operation2",
              Status: OperationStatus.STARTED,
              Type: undefined,
              StartTimestamp: undefined,
            },
            events: [{ EventId: 2 }],
          },
        ]);

        // Update first operation
        indexed.addOperations([
          {
            operation: {
              Id: "op1",
              Name: "operation1",
              Status: OperationStatus.SUCCEEDED,
              Type: undefined,
              StartTimestamp: undefined,
            },
            events: [{ EventId: 1 }, { EventId: 3 }],
          },
        ]);

        const historyEvents = indexed.getHistoryEvents();

        // Events should be in the order they were added to history
        expect(historyEvents).toHaveLength(3);
        expect(historyEvents.map((e) => e.EventId)).toEqual([1, 2, 3]);
      });

      it("should handle edge case where new operation has fewer events than existing", () => {
        const indexed = new IndexedOperations([]);

        // Add operation with multiple events
        const operationWithManyEvents: OperationEvents = {
          operation: {
            Id: "op1",
            Name: "operation1",
            Status: OperationStatus.STARTED,
            Type: undefined,
            StartTimestamp: undefined,
          },
          events: [{ EventId: 1 }, { EventId: 2 }, { EventId: 3 }],
        };

        indexed.addOperations([operationWithManyEvents]);
        let historyEvents = indexed.getHistoryEvents();
        expect(historyEvents).toHaveLength(3);

        // Update with fewer events (this shouldn't normally happen in practice, but testing edge case)
        const operationWithFewerEvents: OperationEvents = {
          operation: {
            Id: "op1",
            Name: "operation1",
            Status: OperationStatus.FAILED,
            Type: undefined,
            StartTimestamp: undefined,
          },
          events: [{ EventId: 1 }, { EventId: 2 }],
        };

        indexed.addOperations([operationWithFewerEvents]);
        historyEvents = indexed.getHistoryEvents();

        // Should still have original 3 events (no new events added since slice(3) of 2-element array is empty)
        expect(historyEvents).toHaveLength(3);
        expect(historyEvents.map((e) => e.EventId)).toEqual([1, 2, 3]);
      });
    });
  });

  describe("getById", () => {
    it("should retrieve operation by id", () => {
      const indexed = new IndexedOperations(sampleOperations);
      const operation = indexed.getById("op2");

      expect(operation).toBeDefined();
      expect(operation?.operation.Id).toBe("op2");
    });

    it("should return undefined for non-existent id", () => {
      const indexed = new IndexedOperations(sampleOperations);
      const operation = indexed.getById("non-existent");

      expect(operation).toBeUndefined();
    });
  });

  describe("getByIndex", () => {
    it("should retrieve operation by index", () => {
      const indexed = new IndexedOperations(sampleOperations);
      const operation = indexed.getByIndex(1);

      expect(operation).toBeDefined();
      expect(operation?.operation.Id).toBe("op2");
    });

    it("should return the first operation when index is 0", () => {
      const indexed = new IndexedOperations(sampleOperations);
      const operation = indexed.getByIndex(0);

      expect(operation).toBeDefined();
      expect(operation?.operation.Id).toBe("op1");
    });

    it("should return undefined for out of bounds index", () => {
      const indexed = new IndexedOperations(sampleOperations);
      const operation = indexed.getByIndex(10);

      expect(operation).toBeUndefined();
    });
  });

  describe("getByNameAndIndex", () => {
    it("should retrieve operation by name and index", () => {
      const indexed = new IndexedOperations(sampleOperations);
      const operation = indexed.getByNameAndIndex("operation1", 1);

      expect(operation).toBeDefined();
      expect(operation?.operation.Id).toBe("op3");
    });

    it("should return the first operation with the name when index is 0", () => {
      const indexed = new IndexedOperations(sampleOperations);
      const operation = indexed.getByNameAndIndex("operation1");

      expect(operation).toBeDefined();
      expect(operation?.operation.Id).toBe("op1");
    });

    it("should return undefined for non-existent name", () => {
      const indexed = new IndexedOperations(sampleOperations);
      const operation = indexed.getByNameAndIndex("non-existent");

      expect(operation).toBeUndefined();
    });

    it("should return undefined for out of bounds index", () => {
      const indexed = new IndexedOperations(sampleOperations);
      const operation = indexed.getByNameAndIndex("operation1", 2);

      expect(operation).toBeUndefined();
    });
  });

  describe("getOperationChildren", () => {
    const parentChildOperations: OperationEvents[] = [
      {
        operation: {
          Id: "parent1",
          Name: "parent-operation",
          Status: OperationStatus.SUCCEEDED,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      },
      {
        operation: {
          Id: "child1",
          Name: "child-operation-1",
          ParentId: "parent1",
          Status: OperationStatus.SUCCEEDED,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      },
      {
        operation: {
          Id: "child2",
          Name: "child-operation-2",
          ParentId: "parent1",
          Status: OperationStatus.FAILED,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      },
      {
        operation: {
          Id: "orphan",
          Name: "orphan-operation",
          Status: OperationStatus.SUCCEEDED,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      },
      {
        operation: {
          Id: "child3",
          Name: "child-operation-3",
          ParentId: "different-parent",
          Status: OperationStatus.SUCCEEDED,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      },
    ];

    it("should return empty array when parent has no children", () => {
      const indexed = new IndexedOperations(parentChildOperations);
      const children = indexed.getOperationChildren("orphan");

      expect(children).toEqual([]);
    });

    it("should return empty array when parent id does not exist", () => {
      const indexed = new IndexedOperations(parentChildOperations);
      const children = indexed.getOperationChildren("nonexistent");

      expect(children).toEqual([]);
    });

    it("should return all children for a parent", () => {
      const indexed = new IndexedOperations(parentChildOperations);
      const children = indexed.getOperationChildren("parent1");

      expect(children).toHaveLength(2);
      expect(children.map((c) => c.operation.Id)).toContain("child1");
      expect(children.map((c) => c.operation.Id)).toContain("child2");
    });

    it("should return child operations with correct data", () => {
      const indexed = new IndexedOperations(parentChildOperations);
      const children = indexed.getOperationChildren("parent1");

      const child1 = children.find((c) => c.operation.Id === "child1");
      const child2 = children.find((c) => c.operation.Id === "child2");

      expect(child1).toBeDefined();
      expect(child1?.operation.Name).toBe("child-operation-1");
      expect(child1?.operation.Status).toBe(OperationStatus.SUCCEEDED);
      expect(child1?.operation.ParentId).toBe("parent1");

      expect(child2).toBeDefined();
      expect(child2?.operation.Name).toBe("child-operation-2");
      expect(child2?.operation.Status).toBe(OperationStatus.FAILED);
      expect(child2?.operation.ParentId).toBe("parent1");
    });

    it("should return only children for the specific parent", () => {
      const indexed = new IndexedOperations(parentChildOperations);
      const children = indexed.getOperationChildren("different-parent");

      expect(children).toHaveLength(1);
      expect(children[0].operation.Id).toBe("child3");
    });

    it("should handle operations without ParentId correctly", () => {
      const indexed = new IndexedOperations([
        {
          operation: {
            Id: "op1",
            Name: "operation1",
            Status: OperationStatus.SUCCEEDED,
            Type: undefined,
            StartTimestamp: undefined,
          },
          events: [],
        },
      ]);
      const children = indexed.getOperationChildren("op1");

      expect(children).toEqual([]);
    });

    it("should handle parent-child relationships when operations are added later", () => {
      const indexed = new IndexedOperations([]);

      // Initially no children
      expect(indexed.getOperationChildren("parent1")).toEqual([]);

      // Add operations
      indexed.addOperations(parentChildOperations);

      // Now should have children
      const children = indexed.getOperationChildren("parent1");
      expect(children).toHaveLength(2);
    });

    it("should throw error when trying to change operation parent", () => {
      const indexed = new IndexedOperations(parentChildOperations);

      // Initially child1 has parent1
      const initialChildren = indexed.getOperationChildren("parent1");
      expect(initialChildren).toHaveLength(2);

      // Try to replace child1 with different parent - should throw error
      expect(() => {
        indexed.addOperations([
          {
            operation: {
              Id: "child1", // Same ID
              Name: "child-operation-1-updated",
              ParentId: "new-parent", // Different parent
              Status: OperationStatus.SUCCEEDED,
              Type: undefined,
              StartTimestamp: undefined,
            },
            events: [],
          },
        ]);
      }).toThrow(
        "Cannot change ParentId of operation child1 from parent1 to new-parent",
      );

      // parent1 should still have both children (no change)
      const parent1Children = indexed.getOperationChildren("parent1");
      expect(parent1Children).toHaveLength(2);
      expect(parent1Children.map((c) => c.operation.Id)).toContain("child1");
      expect(parent1Children.map((c) => c.operation.Id)).toContain("child2");
    });

    it("should handle operations with undefined ParentId", () => {
      const indexed = new IndexedOperations([
        {
          operation: {
            Id: "op1",
            Name: "operation1",
            ParentId: undefined,
            Status: OperationStatus.SUCCEEDED,
            Type: undefined,
            StartTimestamp: undefined,
          },
          events: [],
        },
      ]);

      // Should not crash and should return empty array for any parent
      expect(indexed.getOperationChildren("any-parent")).toEqual([]);
    });

    it("should handle empty string ParentId", () => {
      const indexed = new IndexedOperations([
        {
          operation: {
            Id: "child",
            Name: "child-operation",
            ParentId: "", // Empty string parent ID
            Status: OperationStatus.SUCCEEDED,
            Type: undefined,
            StartTimestamp: undefined,
          },
          events: [],
        },
      ]);

      // Should work with empty string as parent ID
      const children = indexed.getOperationChildren("");
      expect(children).toHaveLength(1);
      expect(children[0].operation.Id).toBe("child");
    });
  });

  describe("executionOperation handling", () => {
    describe("should exclude execution operations from main indexes", () => {
      const executionOperation: OperationEvents = {
        operation: {
          Id: "execution-1",
          Name: "my-execution",
          Type: OperationType.EXECUTION,
          Status: OperationStatus.STARTED,
          StartTimestamp: undefined,
        },
        events: [
          {
            EventId: 100,
          },
        ],
      };

      const regularOperation: OperationEvents = {
        operation: {
          Id: "step-1",
          Name: "my-step",
          Type: OperationType.STEP,
          Status: OperationStatus.SUCCEEDED,
          StartTimestamp: undefined,
        },
        events: [
          {
            EventId: 101,
          },
        ],
      };

      it("should not include execution operations in getOperations()", () => {
        const indexed = new IndexedOperations([
          executionOperation,
          regularOperation,
        ]);

        const operations = indexed.getOperations();

        // Should only contain the regular operation, not the execution operation
        expect(operations).toHaveLength(1);
        expect(operations[0].operation.Id).toBe("step-1");
        expect(operations[0].operation.Type).toBe(OperationType.STEP);
      });

      it("should not find execution operations with getById()", () => {
        const indexed = new IndexedOperations([
          executionOperation,
          regularOperation,
        ]);

        // Regular operation should be found
        expect(indexed.getById("step-1")).toBeDefined();
        expect(indexed.getById("step-1")?.operation.Type).toBe(
          OperationType.STEP,
        );

        // Execution operation should NOT be found via getById
        expect(indexed.getById("execution-1")).toBeUndefined();
      });

      it("should not find execution operations with getByIndex()", () => {
        const indexed = new IndexedOperations([
          executionOperation,
          regularOperation,
        ]);

        // Should only have one operation accessible by index (the regular operation)
        expect(indexed.getByIndex(0)).toBeDefined();
        expect(indexed.getByIndex(0)?.operation.Id).toBe("step-1");
        expect(indexed.getByIndex(0)?.operation.Type).toBe(OperationType.STEP);

        // Second index should be undefined since execution operation is excluded
        expect(indexed.getByIndex(1)).toBeUndefined();
      });

      it("should not find execution operations with getByNameAndIndex()", () => {
        const indexed = new IndexedOperations([
          executionOperation,
          regularOperation,
        ]);

        // Regular operation should be found by name
        expect(indexed.getByNameAndIndex("my-step")).toBeDefined();
        expect(indexed.getByNameAndIndex("my-step")?.operation.Id).toBe(
          "step-1",
        );

        // Execution operation should NOT be found by name
        expect(indexed.getByNameAndIndex("my-execution")).toBeUndefined();
      });

      it("should still include execution operation events in history", () => {
        const indexed = new IndexedOperations([
          executionOperation,
          regularOperation,
        ]);

        const historyEvents = indexed.getHistoryEvents();

        // Should include events from both operations
        expect(historyEvents).toHaveLength(2);
        expect(historyEvents.map((e) => e.EventId)).toContain(100);
        expect(historyEvents.map((e) => e.EventId)).toContain(101);
      });

      it("should handle multiple execution operations by keeping the last one", () => {
        const firstExecution: OperationEvents = {
          operation: {
            Id: "execution-1",
            Name: "first-execution",
            Type: OperationType.EXECUTION,
            Status: OperationStatus.STARTED,
            StartTimestamp: undefined,
          },
          events: [{ EventId: 100 }],
        };

        const secondExecution: OperationEvents = {
          operation: {
            Id: "execution-2",
            Name: "second-execution",
            Type: OperationType.EXECUTION,
            Status: OperationStatus.SUCCEEDED,
            StartTimestamp: undefined,
          },
          events: [{ EventId: 200 }],
        };

        const indexed = new IndexedOperations([
          firstExecution,
          regularOperation,
          secondExecution,
        ]);

        // Should still only have one regular operation
        expect(indexed.getOperations()).toHaveLength(1);
        expect(indexed.getOperations()[0].operation.Id).toBe("step-1");

        // Should have events from all operations including both executions
        const historyEvents = indexed.getHistoryEvents();
        expect(historyEvents).toHaveLength(3);
        expect(historyEvents.map((e) => e.EventId)).toContain(100);
        expect(historyEvents.map((e) => e.EventId)).toContain(101);
        expect(historyEvents.map((e) => e.EventId)).toContain(200);
      });

      it("should handle updating execution operation with same ID", () => {
        const indexed = new IndexedOperations([
          executionOperation,
          regularOperation,
        ]);

        // Add updated execution with same ID but additional events
        const updatedExecution: OperationEvents = {
          operation: {
            Id: "execution-1", // Same ID
            Name: "my-execution-updated",
            Type: OperationType.EXECUTION,
            Status: OperationStatus.SUCCEEDED,
            StartTimestamp: undefined,
          },
          events: [
            { EventId: 100 }, // Existing
            { EventId: 102 }, // New
          ],
        };

        indexed.addOperations([updatedExecution]);

        // Should still only have one regular operation
        expect(indexed.getOperations()).toHaveLength(1);
        expect(indexed.getOperations()[0].operation.Id).toBe("step-1");

        // Should have events from both operations plus the new execution event
        const historyEvents = indexed.getHistoryEvents();
        expect(historyEvents).toHaveLength(3);
        expect(historyEvents.map((e) => e.EventId)).toContain(100);
        expect(historyEvents.map((e) => e.EventId)).toContain(101);
        expect(historyEvents.map((e) => e.EventId)).toContain(102);
      });

      it("should handle execution operations with parent-child relationships (execution operations cannot have parents but can be parents)", () => {
        const executionWithChild: OperationEvents = {
          operation: {
            Id: "execution-parent",
            Name: "parent-execution",
            Type: OperationType.EXECUTION,
            Status: OperationStatus.STARTED,
            StartTimestamp: undefined,
          },
          events: [{ EventId: 300 }],
        };

        const childOfExecution: OperationEvents = {
          operation: {
            Id: "child-of-execution",
            Name: "child-step",
            Type: OperationType.STEP,
            ParentId: "execution-parent",
            Status: OperationStatus.SUCCEEDED,
            StartTimestamp: undefined,
          },
          events: [{ EventId: 301 }],
        };

        const indexed = new IndexedOperations([
          executionWithChild,
          childOfExecution,
        ]);

        // Regular operations should be indexed
        expect(indexed.getOperations()).toHaveLength(1);
        expect(indexed.getOperations()[0].operation.Id).toBe(
          "child-of-execution",
        );

        // Should be able to find children of execution operation
        const children = indexed.getOperationChildren("execution-parent");
        expect(children).toHaveLength(1);
        expect(children[0].operation.Id).toBe("child-of-execution");
        expect(children[0].operation.ParentId).toBe("execution-parent");

        // History should include events from both
        const historyEvents = indexed.getHistoryEvents();
        expect(historyEvents).toHaveLength(2);
        expect(historyEvents.map((e) => e.EventId)).toContain(300);
        expect(historyEvents.map((e) => e.EventId)).toContain(301);
      });

      it("should handle mixed operations with execution operations", () => {
        const operations: OperationEvents[] = [
          {
            operation: {
              Id: "step-1",
              Name: "first-step",
              Type: OperationType.STEP,
              Status: OperationStatus.SUCCEEDED,
              StartTimestamp: undefined,
            },
            events: [{ EventId: 1 }],
          },
          {
            operation: {
              Id: "execution-1",
              Name: "execution",
              Type: OperationType.EXECUTION,
              Status: OperationStatus.STARTED,
              StartTimestamp: undefined,
            },
            events: [{ EventId: 2 }],
          },
          {
            operation: {
              Id: "wait-1",
              Name: "wait-operation",
              Type: OperationType.WAIT,
              Status: OperationStatus.STARTED,
              StartTimestamp: undefined,
            },
            events: [{ EventId: 3 }],
          },
          {
            operation: {
              Id: "context-1",
              Name: "context-operation",
              Type: OperationType.CONTEXT,
              Status: OperationStatus.SUCCEEDED,
              StartTimestamp: undefined,
            },
            events: [{ EventId: 4 }],
          },
        ];

        const indexed = new IndexedOperations(operations);

        // Should only have non-execution operations
        const allOps = indexed.getOperations();
        expect(allOps).toHaveLength(3);

        const operationTypes = allOps.map((op) => op.operation.Type);
        expect(operationTypes).toContain(OperationType.STEP);
        expect(operationTypes).toContain(OperationType.WAIT);
        expect(operationTypes).toContain(OperationType.CONTEXT);
        expect(operationTypes).not.toContain(OperationType.EXECUTION);

        // Should find non-execution operations by ID
        expect(indexed.getById("step-1")).toBeDefined();
        expect(indexed.getById("wait-1")).toBeDefined();
        expect(indexed.getById("context-1")).toBeDefined();
        expect(indexed.getById("execution-1")).toBeUndefined();

        // Should find non-execution operations by name
        expect(indexed.getByNameAndIndex("first-step")).toBeDefined();
        expect(indexed.getByNameAndIndex("wait-operation")).toBeDefined();
        expect(indexed.getByNameAndIndex("context-operation")).toBeDefined();
        expect(indexed.getByNameAndIndex("execution")).toBeUndefined();

        // History should include all events
        const historyEvents = indexed.getHistoryEvents();
        expect(historyEvents).toHaveLength(4);
        expect(historyEvents.map((e) => e.EventId)).toEqual([1, 2, 3, 4]);
      });
    });
  });
});
