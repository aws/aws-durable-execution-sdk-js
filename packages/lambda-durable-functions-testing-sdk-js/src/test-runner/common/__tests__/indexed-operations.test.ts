import { OperationStatus } from "@aws-sdk/client-lambda";
import { IndexedOperations } from "../indexed-operations";

describe("IndexedOperations", () => {
  // Sample operations for testing
  const sampleOperations = [
    {
      operation: {
        Id: "op1",
        Name: "operation1",
        Status: OperationStatus.SUCCEEDED,
      },
      events: [],
    },
    {
      operation: {
        Id: "op2",
        Name: "operation2",
        Status: OperationStatus.SUCCEEDED,
      },
      events: [],
    },
    {
      operation: {
        Id: "op3",
        Name: "operation1", // Same name as first operation
        Status: OperationStatus.FAILED,
      },
      events: [],
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

  describe("addOperations", () => {
    it("should add operations to the collection", () => {
      const indexed = new IndexedOperations([]);
      indexed.addOperations(sampleOperations);

      expect(indexed.getOperations()).toHaveLength(sampleOperations.length);
    });

    it("should replace existing operations with same ID instead of creating duplicates", () => {
      const indexed = new IndexedOperations([]);

      // Add initial operation
      const initialOperation = {
        Id: "op1",
        Name: "operation1",
        Status: OperationStatus.STARTED,
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
        OperationStatus.STARTED
      );

      // Add operation with same ID but different properties
      const updatedOperation = {
        Id: "op1",
        Name: "operation1-updated",
        Status: OperationStatus.SUCCEEDED,
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
        OperationStatus.SUCCEEDED
      );
      expect(retrievedByIndex?.operation.Name).toBe("operation1-updated");
    });

    it("should handle multiple operations with same ID by keeping the last one", () => {
      const indexed = new IndexedOperations([]);

      const operations = [
        {
          operation: {
            Id: "op1",
            Name: "operation1",
            Status: OperationStatus.STARTED,
          },
          events: [],
        },
        {
          operation: {
            Id: "op2",
            Name: "operation2",
            Status: OperationStatus.STARTED,
          },
          events: [],
        },
        {
          operation: {
            Id: "op1",
            Name: "operation1-updated",
            Status: OperationStatus.SUCCEEDED,
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
      const initialOperation = {
        operation: {
          Id: "op1",
          Name: "original-name",
          Status: OperationStatus.STARTED,
        },
        events: [],
      };
      indexed.addOperations([initialOperation]);

      // Verify it can be found by original name
      expect(indexed.getByNameAndIndex("original-name", 0)).toBeDefined();
      expect(indexed.getByNameAndIndex("original-name", 0)?.operation.Id).toBe(
        "op1"
      );

      // Add operation with same ID but different name
      const updatedOperation = {
        operation: {
          Id: "op1",
          Name: "updated-name",
          Status: OperationStatus.SUCCEEDED,
        },
        events: [],
      };
      indexed.addOperations([updatedOperation]);

      // Should be accessible by new name
      expect(indexed.getByNameAndIndex("updated-name", 0)).toBeDefined();
      expect(indexed.getByNameAndIndex("updated-name", 0)?.operation.Id).toBe(
        "op1"
      );
      expect(
        indexed.getByNameAndIndex("updated-name", 0)?.operation.Status
      ).toBe(OperationStatus.SUCCEEDED);

      // Should still be accessible by original name (since the name index contains both entries)
      expect(indexed.getByNameAndIndex("original-name", 0)).toBeDefined();
      expect(indexed.getByNameAndIndex("original-name", 0)?.operation.Id).toBe(
        "op1"
      );
    });

    it("should generate operations array dynamically from operationsById map", () => {
      const indexed = new IndexedOperations([]);

      // Add some operations
      const operations = [
        {
          operation: {
            Id: "op1",
            Name: "operation1",
            Status: OperationStatus.STARTED,
          },
          events: [],
        },
        {
          operation: {
            Id: "op2",
            Name: "operation2",
            Status: OperationStatus.SUCCEEDED,
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
        allOperations.find((op) => op.operation.Id === "op1")
      ).toBeDefined();
      expect(
        allOperations.find((op) => op.operation.Id === "op2")
      ).toBeDefined();

      // Add an operation with same ID as existing one
      const updatedOp1 = {
        operation: {
          Id: "op1",
          Name: "operation1-updated",
          Status: OperationStatus.SUCCEEDED,
        },
        events: [],
      };

      indexed.addOperations([updatedOp1]);

      // Should still have 2 operations total, but op1 should be updated
      const updatedOperations = indexed.getOperations();
      expect(updatedOperations).toHaveLength(2);

      const foundOp1 = updatedOperations.find(
        (op) => op.operation.Id === "op1"
      );
      expect(foundOp1?.operation.Name).toBe("operation1-updated");
      expect(foundOp1?.operation.Status).toBe(OperationStatus.SUCCEEDED);
    });

    it("should not handle operations without id", () => {
      const indexed = new IndexedOperations([]);
      const operationWithoutId = {
        Status: OperationStatus.STARTED,
        Name: "my-operation-name",
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
      const operationWithEmptyId = {
        operation: {
          Id: "",
          Name: undefined,
          Status: OperationStatus.SUCCEEDED,
        },
        events: [],
      };

      indexed.addOperations([operationWithEmptyId]);

      expect(indexed.getOperations()).toHaveLength(1);
      expect(indexed.getById("")).toBe(operationWithEmptyId);
    });

    it("should handle operations with empty string name", () => {
      const indexed = new IndexedOperations([]);
      const operationWithEmptyName = {
        operation: {
          Id: "test-op",
          Name: "",
          Status: OperationStatus.SUCCEEDED,
        },
        events: [],
      };

      indexed.addOperations([operationWithEmptyName]);

      expect(indexed.getOperations()).toHaveLength(1);
      expect(indexed.getByNameAndIndex("", 0)).toBe(operationWithEmptyName);
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
    const parentChildOperations = [
      {
        operation: {
          Id: "parent1",
          Name: "parent-operation",
          Status: OperationStatus.SUCCEEDED,
        },
        events: [],
      },
      {
        operation: {
          Id: "child1",
          Name: "child-operation-1",
          ParentId: "parent1",
          Status: OperationStatus.SUCCEEDED,
        },
        events: [],
      },
      {
        operation: {
          Id: "child2",
          Name: "child-operation-2",
          ParentId: "parent1",
          Status: OperationStatus.FAILED,
        },
        events: [],
      },
      {
        operation: {
          Id: "orphan",
          Name: "orphan-operation",
          Status: OperationStatus.SUCCEEDED,
        },
        events: [],
      },
      {
        operation: {
          Id: "child3",
          Name: "child-operation-3",
          ParentId: "different-parent",
          Status: OperationStatus.SUCCEEDED,
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
            },
            events: [],
          },
        ]);
      }).toThrow(
        "Cannot change ParentId of operation child1 from parent1 to new-parent"
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
});
