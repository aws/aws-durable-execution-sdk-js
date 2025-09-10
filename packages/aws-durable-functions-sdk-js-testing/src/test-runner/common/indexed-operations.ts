import { CheckpointOperation } from "../../checkpoint-server/storage/checkpoint-manager";

/**
 * Optimized way of retrieving operations by id and name/index.
 *
 * Avoids re-iterating over the operations list every time an operation needs to be fetched.
 */
export class IndexedOperations {
  private readonly operationsById = new Map<string, CheckpointOperation>();
  private readonly operationsByName = new Map<
    string,
    Map<string, CheckpointOperation>
  >();
  private readonly operationsByParentId = new Map<
    string,
    Map<string, CheckpointOperation>
  >();

  constructor(operations: CheckpointOperation[]) {
    this.addOperations(operations);
  }

  getOperations(): CheckpointOperation[] {
    return Array.from(this.operationsById.values());
  }

  addOperations(checkpointOperations: CheckpointOperation[]) {
    for (const checkpointOperation of checkpointOperations) {
      const { operation } = checkpointOperation;
      if (operation.Id === undefined) {
        throw new Error("Cannot add operation without an ID");
      }

      // Check if operation already exists and validate parent doesn't change
      const existingOperation = this.operationsById.get(operation.Id);
      if (existingOperation) {
        const existingParentId = existingOperation.operation.ParentId;
        // Throw error if parent has changed
        if (existingParentId !== operation.ParentId) {
          throw new Error(
            `Cannot change ParentId of operation ${operation.Id} from ${existingParentId} to ${operation.ParentId}`
          );
        }
      }

      // Index by ID
      this.operationsById.set(operation.Id, checkpointOperation);

      // Index by name - group operations with the same name
      if (operation.Name !== undefined) {
        const nameOps =
          this.operationsByName.get(operation.Name) ??
          new Map<string, CheckpointOperation>();
        nameOps.set(operation.Id, checkpointOperation);
        this.operationsByName.set(operation.Name, nameOps);
      }

      if (operation.ParentId !== undefined) {
        const childOperations =
          this.operationsByParentId.get(operation.ParentId) ??
          new Map<string, CheckpointOperation>();
        childOperations.set(operation.Id, checkpointOperation);
        this.operationsByParentId.set(operation.ParentId, childOperations);
      }
    }
  }

  getOperationChildren(id: string): CheckpointOperation[] {
    const operations = this.operationsByParentId.get(id);
    return operations ? Array.from(operations.values()) : [];
  }

  /**
   * Get an operation by its ID
   * @param id The operation ID
   * @returns The operation with the matching ID
   */
  getById(id: string): CheckpointOperation | undefined {
    const operation = this.operationsById.get(id);
    return operation;
  }

  getByIndex(index: number): CheckpointOperation | undefined {
    return this.getOperations().at(index);
  }

  /**
   * Get an operation by name and index
   * @param name The operation name
   * @param index The index of the operation among operations with the same name. Defaults to 0
   * @returns The operation at the specified name and index
   */
  getByNameAndIndex(name: string, index = 0): CheckpointOperation | undefined {
    const operations = this.operationsByName.get(name);
    return operations ? Array.from(operations.values()).at(index) : undefined;
  }
}
