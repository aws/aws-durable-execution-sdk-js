import { DurableOperationError } from "../durable-error/durable-error";

/**
 * Error thrown at DAG registration when a cyclic dependency is detected among
 * tasks. Carries the list of task names participating in the cycle.
 *
 * @experimental This error is experimental and may be changed or removed in future releases.
 */
export class DagCyclicDependencyError extends DurableOperationError {
  readonly errorType = "DagCyclicDependencyError";

  constructor(
    /** Names of the tasks that form the cycle. */
    public readonly cyclicTasks: string[],
    message?: string,
    cause?: Error,
    errorData?: string,
  ) {
    super(
      message ||
        `DAG contains a cyclic dependency among tasks: ${cyclicTasks.join(", ")}`,
      cause,
      errorData,
    );
  }
}

/**
 * Error thrown at DAG registration when a task name is invalid (empty, too
 * long, contains disallowed characters, or embeds the reserved token).
 *
 * @experimental This error is experimental and may be changed or removed in future releases.
 */
export class DagInvalidTaskNameError extends DurableOperationError {
  readonly errorType = "DagInvalidTaskNameError";

  constructor(
    /** The offending task name. */
    public readonly taskName: string,
    message?: string,
    cause?: Error,
    errorData?: string,
  ) {
    super(message || `Invalid DAG task name: "${taskName}"`, cause, errorData);
  }
}

/**
 * Error thrown at DAG registration when two tasks are registered under the
 * same name within a single DAG scope.
 *
 * @experimental This error is experimental and may be changed or removed in future releases.
 */
export class DagDuplicateTaskError extends DurableOperationError {
  readonly errorType = "DagDuplicateTaskError";

  constructor(
    /** The duplicated task name. */
    public readonly taskName: string,
    message?: string,
    cause?: Error,
    errorData?: string,
  ) {
    super(
      message || `Duplicate DAG task name: "${taskName}"`,
      cause,
      errorData,
    );
  }
}

/**
 * Error thrown at DAG registration when a task declares a dependency on a task
 * handle that does not belong to the current DAG scope.
 *
 * @experimental This error is experimental and may be changed or removed in future releases.
 */
export class DagInvalidDependencyError extends DurableOperationError {
  readonly errorType = "DagInvalidDependencyError";

  constructor(
    /** The task whose dependency is invalid. */
    public readonly taskName: string,
    message?: string,
    cause?: Error,
    errorData?: string,
  ) {
    super(
      message ||
        `Task "${taskName}" depends on a task that is not registered in this DAG`,
      cause,
      errorData,
    );
  }
}

/**
 * Error thrown by {@link DagResult.throwIfError} when one or more DAG tasks
 * failed (or a custom completion decision returned a `FAILED` outcome). Carries
 * the first failed task's error as `cause`.
 *
 * Defined in `durable-error.ts` (co-located with the other registered
 * {@link DurableOperationError} subclasses so `fromErrorObject` can reconstruct
 * it without a circular import) and re-exported here for the DAG surface.
 *
 * @experimental This error is experimental and may be changed or removed in future releases.
 */
export { DagExecutionError } from "../durable-error/durable-error";
