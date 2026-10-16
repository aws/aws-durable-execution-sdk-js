import type { OperationInfo } from "@aws/durable-execution-sdk-js";

function isExternalOperation(info: OperationInfo): boolean {
  return (
    info.type === "WAIT" ||
    info.type === "INVOKE" ||
    info.type === "CHAINED_INVOKE" ||
    info.type === "CALLBACK"
  );
}

/** Invocation-local bookkeeping; no export acknowledgement is persisted. */
export class ExternalCompletions {
  readonly pending = new Map<string, OperationInfo>();
  private readonly exported = new Set<string>();

  observe(
    updates: Record<string, OperationInfo> = {},
    operations: Record<string, OperationInfo> = {},
  ): void {
    for (const info of Object.values(updates)) {
      if (
        info.id &&
        isExternalOperation(info) &&
        (info.status === "SUCCEEDED" ||
          info.status === "FAILED" ||
          info.status === "TIMED_OUT" ||
          info.status === "STOPPED" ||
          info.status === "CANCELLED") &&
        !this.exported.has(info.id)
      ) {
        const parent = info.parentId ? operations[info.parentId] : undefined;
        // waitForCallback's derived inner name is hook-only, not persisted.
        // A skipped branch cannot backfill it before the deferred export.
        const completion =
          info.type === "CALLBACK" &&
          info.name === undefined &&
          parent?.type === "CONTEXT" &&
          parent.subType === "WaitForCallback" &&
          parent.name
            ? { ...info, name: `${parent.name}-callback` }
            : info;
        this.pending.set(info.id, completion);
      }
    }
  }

  shouldSkip(info: OperationInfo): boolean {
    // Replay describes the SDK's initial state, not whether a completion that
    // arrived later in a checkpoint response has already been exported.
    return (
      isExternalOperation(info) &&
      (this.exported.has(info.id) ||
        (info.isReplay && !this.pending.has(info.id)))
    );
  }

  markExported(info: OperationInfo): void {
    if (isExternalOperation(info)) {
      this.exported.add(info.id);
      this.pending.delete(info.id);
    }
  }

  clear(): void {
    this.pending.clear();
    this.exported.clear();
  }
}
