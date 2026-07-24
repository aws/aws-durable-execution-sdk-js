import { TaskDef } from "./task-handle";
import {
  DagCyclicDependencyError,
  DagDuplicateTaskError,
  DagInvalidDependencyError,
  DagInvalidTaskNameError,
} from "../../errors/dag-errors/dag-errors";

const TASK_NAME_PATTERN = /^[a-zA-Z0-9_]+$/;
const RESERVED_TOKEN = "DAG_NODE_T_";
const MAX_NAME_LENGTH = 100;

/**
 * Validates a single task name eagerly at registration. Names must be
 * non-empty, at most 100 chars, match `^[a-zA-Z0-9_]+$` (no dash), and must not
 * embed the reserved `DAG_NODE_T_` token.
 *
 * @internal
 */
export function validateTaskName(name: string): void {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > MAX_NAME_LENGTH ||
    !TASK_NAME_PATTERN.test(name) ||
    name.includes(RESERVED_TOKEN)
  ) {
    throw new DagInvalidTaskNameError(name);
  }
}

/**
 * Kahn's-algorithm cycle detection over `allDeps` (inline ∪ builder edges).
 * Returns the list of cyclic task names, or `null` if the graph is acyclic.
 *
 * @internal
 */
export function detectCycle(tasks: TaskDef[]): string[] | null {
  const inDegree = new Map<string, number>(
    tasks.map((t) => [t.name, t.allDeps.length]),
  );
  const queue = tasks
    .filter((t) => inDegree.get(t.name) === 0)
    .map((t) => t.name);
  const visited: string[] = [];
  while (queue.length) {
    const n = queue.shift() as string;
    visited.push(n);
    for (const t of tasks) {
      if (t.allDeps.some((d) => d._name === n)) {
        const d = (inDegree.get(t.name) as number) - 1;
        inDegree.set(t.name, d);
        if (d === 0) {
          queue.push(t.name);
        }
      }
    }
  }
  return visited.length === tasks.length
    ? null
    : tasks.filter((t) => !visited.includes(t.name)).map((t) => t.name);
}

/**
 * Runs full DAG validation after `register` returns and before scheduling:
 * name rules, duplicate detection, missing/foreign-scope dependency checks, and
 * cycle detection. Throws the matching `Dag*Error`.
 *
 * @internal
 */
export function validateDag(tasks: TaskDef[]): void {
  const seen = new Set<string>();
  const ids = new Set<symbol>(tasks.map((t) => t.id));

  for (const task of tasks) {
    validateTaskName(task.name);
    if (seen.has(task.name)) {
      throw new DagDuplicateTaskError(task.name);
    }
    seen.add(task.name);
  }

  for (const task of tasks) {
    for (const dep of task.allDeps) {
      if (!ids.has(dep._id)) {
        throw new DagInvalidDependencyError(task.name);
      }
    }
  }

  const cyclic = detectCycle(tasks);
  if (cyclic) {
    throw new DagCyclicDependencyError(cyclic);
  }
}
