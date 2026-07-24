import {
  AnyTaskHandle,
  DagCompletionReason,
  DagResult,
  TaskExecution,
  TaskHandle,
  TaskStatus,
} from "../../types/dag";
import { DagExecutionError } from "../../errors/dag-errors/dag-errors";

/**
 * Concrete {@link DagResult}. Computes counts once at construction and resolves
 * results by task name.
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class DagResultImpl implements DagResult {
  readonly results: ReadonlyMap<string, TaskExecution>;
  readonly successCount: number;
  readonly failureCount: number;
  readonly skippedCount: number;
  readonly totalCount: number;
  readonly completionReason: DagCompletionReason;

  constructor(
    results: Map<string, TaskExecution>,
    completionReason: DagCompletionReason,
    totalCount?: number,
  ) {
    this.results = results;
    this.completionReason = completionReason;
    let success = 0;
    let failure = 0;
    let skipped = 0;
    for (const exec of results.values()) {
      if (exec.status === "SUCCEEDED") {
        success++;
      } else if (exec.status === "FAILED") {
        failure++;
      } else if (exec.status === "SKIPPED") {
        skipped++;
      }
    }
    this.successCount = success;
    this.failureCount = failure;
    this.skippedCount = skipped;
    this.totalCount = totalCount ?? results.size;
  }

  getResult<TResult>(handle: TaskHandle<string, TResult>): TResult | undefined;
  getResult(name: string): unknown;
  getResult(handleOrName: string | AnyTaskHandle): unknown {
    const name =
      typeof handleOrName === "string" ? handleOrName : handleOrName._name;
    const exec = this.results.get(name);
    return exec && exec.status === "SUCCEEDED" ? exec.result : undefined;
  }

  getStatus(taskNameOrHandle: string | AnyTaskHandle): TaskStatus | undefined {
    const name =
      typeof taskNameOrHandle === "string"
        ? taskNameOrHandle
        : taskNameOrHandle._name;
    return this.results.get(name)?.status;
  }

  succeeded(): TaskExecution[] {
    return [...this.results.values()].filter((e) => e.status === "SUCCEEDED");
  }

  failed(): TaskExecution[] {
    return [...this.results.values()].filter((e) => e.status === "FAILED");
  }

  skipped(): TaskExecution[] {
    return [...this.results.values()].filter((e) => e.status === "SKIPPED");
  }

  throwIfError(): void {
    if (
      this.failureCount > 0 ||
      this.completionReason === "CUSTOM_COMPLETION_FAILED"
    ) {
      const firstError = [...this.results.values()].find(
        (e) => e.status === "FAILED",
      )?.error;
      throw new DagExecutionError(
        `DAG execution had ${this.failureCount} failed task(s)`,
        firstError,
      );
    }
  }
}
