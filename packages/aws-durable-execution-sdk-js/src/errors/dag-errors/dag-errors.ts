/**
 * DAG error classes.
 *
 * These extend {@link DurableOperationError} and are defined in
 * `durable-error.ts` (co-located with the other registered error subclasses so
 * `DurableOperationError.fromErrorObject` can reconstruct them without a
 * circular import). They are re-exported here as the canonical DAG error
 * surface.
 *
 * @experimental These errors are experimental and may be changed or removed in future releases.
 */
export {
  DagCyclicDependencyError,
  DagInvalidTaskNameError,
  DagDuplicateTaskError,
  DagInvalidDependencyError,
  DagExecutionError,
} from "../durable-error/durable-error";
