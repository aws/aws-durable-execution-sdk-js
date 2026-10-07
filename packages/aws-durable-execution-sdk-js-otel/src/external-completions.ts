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
  private flushQueue: Promise<void> = Promise.resolve();

  /** Serialize shutdown work, including updates received while export awaits. */
  drainAndFlush(
    exportOperation: (operation: OperationInfo) => Promise<void>,
    flush: () => Promise<void>,
  ): Promise<void> {
    const next = this.flushQueue.then(async () => {
      do {
        for (const operation of this.pending.values()) {
          await exportOperation(operation);
        }
        await flush();
        // A checkpoint response can arrive while the provider is flushing.
        // Export it and flush again before this shutdown work completes.
      } while (this.pending.size > 0);
    });
    // A failed export must not prevent a later notification from being handled.
    this.flushQueue = next.catch(() => {});
    return next;
  }

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
