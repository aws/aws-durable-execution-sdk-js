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

  observe(operations: Record<string, OperationInfo> = {}): void {
    for (const info of Object.values(operations)) {
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
        this.pending.set(info.id, info);
      }
    }
  }

  shouldSkip(info: OperationInfo): boolean {
    return (
      isExternalOperation(info) && (info.isReplay || this.exported.has(info.id))
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
