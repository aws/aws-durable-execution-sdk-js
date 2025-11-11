import { AsyncLocalStorage } from "async_hooks";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";

interface ContextInfo {
  contextId: string;
  parentId?: string;
}

const asyncLocalStorage = new AsyncLocalStorage<ContextInfo>();

export const getActiveContext = (): ContextInfo | undefined => {
  return asyncLocalStorage.getStore();
};

export const runWithContext = <T>(
  contextId: string,
  parentId: string | undefined,
  fn: () => T,
): T => {
  return asyncLocalStorage.run({ contextId, parentId }, fn);
};

export const validateContextUsage = (
  operationContextId: string | undefined,
  operationName: string,
  terminationManager: TerminationManager,
): void => {
  const contextId = operationContextId || "root";
  const activeContext = getActiveContext();

  if (!activeContext) {
    return;
  }

  if (activeContext.contextId !== contextId) {
    const errorMessage = `Context usage error in "${operationName}": You are using a parent or sibling context instead of the current child context. Expected context ID: "${activeContext.contextId}", but got: "${operationContextId}". When inside runInChildContext(), you must use the child context parameter, not the parent context.`;
    terminationManager.terminate({
      reason: TerminationReason.CONTEXT_VALIDATION_ERROR,
      message: errorMessage,
      error: new Error(errorMessage),
    });

    // Only call termination manager, don't throw or return promise
  }
};
