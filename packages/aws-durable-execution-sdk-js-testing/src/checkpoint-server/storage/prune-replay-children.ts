import {
  Operation,
  OperationStatus,
  OperationType,
} from "@aws/durable-execution-sdk-js";

function prunesItsChildren(operation: Operation): boolean {
  return (
    operation.Type === OperationType.CONTEXT &&
    (operation.Status === OperationStatus.SUCCEEDED ||
      operation.Status === OperationStatus.FAILED) &&
    operation.ContextDetails?.ReplayChildren !== true
  );
}

/**
 * Returns the operations that the service sends to the SDK as execution state,
 * in the order given.
 *
 * The service omits every descendant of a completed CONTEXT whose
 * `ReplayChildren` is not `true`. The SDK replays such a context from its own
 * result, so it does not need the children. The rules, from the service:
 *
 * 1. An operation without a parent is kept.
 * 2. The service walks up the parents of every other operation.
 * 3. It omits the operation if any ancestor is a completed CONTEXT whose
 *    `ReplayChildren` is not `true`. The status of the operations between
 *    them does not matter. So a STARTED context under such an ancestor is
 *    omitted, with its children.
 * 4. A completed CONTEXT with `ReplayChildren: true` keeps its children,
 *    unless one of its own ancestors omits them.
 * 5. An operation whose parent is not in the state is kept.
 *
 * The service applies these rules to the invocation input and to
 * `GetDurableExecutionState`. It does not apply them to the operations in a
 * checkpoint response, or to `UpdatedOperationIds`.
 *
 * @param operations - Every operation of the execution
 * @returns The operations that the service sends
 */
export function pruneReplayChildren<T>(
  operations: readonly T[],
  getOperation: (item: T) => Operation,
): T[] {
  const byId = new Map<string, Operation>();
  for (const item of operations) {
    const operation = getOperation(item);
    if (operation.Id) {
      byId.set(operation.Id, operation);
    }
  }

  // Memoizes the answer for each operation already examined.
  const omitted = new Map<string, boolean>();
  const isOmitted = (operation: Operation): boolean => {
    const chain: string[] = [];
    // The checkpoint validator rejects a parent that does not exist yet, so
    // the stored parents form a tree. This set stops the walk anyway if a
    // ParentId leads back to an operation already on the chain.
    const visited = new Set<string>();
    let result = false;
    let current = operation;
    while (current.ParentId) {
      if (current.Id) {
        const known = omitted.get(current.Id);
        if (known !== undefined) {
          result = known;
          break;
        }
        if (visited.has(current.Id)) {
          break;
        }
        visited.add(current.Id);
        chain.push(current.Id);
      }
      const parent = byId.get(current.ParentId);
      if (!parent) {
        break;
      }
      if (prunesItsChildren(parent)) {
        result = true;
        break;
      }
      current = parent;
    }
    // Every operation on the walked chain sits under the same ancestor. So
    // each one gets the same answer.
    for (const id of chain) {
      omitted.set(id, result);
    }
    return result;
  };

  return operations.filter((item) => !isOmitted(getOperation(item)));
}
