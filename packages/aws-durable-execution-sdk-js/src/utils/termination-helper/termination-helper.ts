import { ExecutionContext, DurableContext } from "../../types";
import { UnrecoverableError } from "../../errors/unrecoverable-error/unrecoverable-error";
import { TerminationReason } from "../../termination-manager/types";
import { log } from "../logger/logger";
import { getActiveContext } from "../context-tracker/context-tracker";

/**
 * Terminates execution from a child context and returns a never-resolving promise
 */
export function terminate<T>(
  context: ExecutionContext,
  reason: TerminationReason,
  message: string,
): Promise<T>;

/**
 * Terminates execution from a parent context
 */
export function terminate(
  context: ExecutionContext,
  reason: TerminationReason,
  message: string,
  callerDurableContext: DurableContext,
): void;

/**
 * Terminates execution with signal delegation support
 * @param context - The execution context containing the termination manager
 * @param reason - The termination reason
 * @param message - The termination message
 * @param callerDurableContext - Optional: The DurableContext of the caller (for parent contexts)
 * @returns A never-resolving promise (for child contexts) or void (for parent contexts)
 */
export function terminate<T>(
  context: ExecutionContext,
  reason: TerminationReason,
  message: string,
  callerDurableContext?: DurableContext,
): Promise<T> | void {
  const activeContext = getActiveContext();

  log("🔍", "terminate called:", {
    reason,
    message,
    hasCallerContext: !!callerDurableContext,
  });

  // Determine which context to check for signal delegation
  let contextToSignal: DurableContext | undefined;
  let contextIdToSignal: string | undefined;

  if (callerDurableContext) {
    // Called from parent handler - check if parent should signal grandparent
    contextToSignal = callerDurableContext._parentDurableContext;
    contextIdToSignal = activeContext?.parentId; // The parent of current child is the caller

    log("🔍", "Parent context termination - checking grandparent:", {
      hasGrandparent: !!contextToSignal,
      hasGrandparentSignal: !!contextToSignal?._onChildSignal,
      callerContextId: contextIdToSignal,
    });
  } else {
    // Called from child context - check if child should signal parent
    const childContext = activeContext?.durableContext;
    contextToSignal = childContext?._parentDurableContext;
    contextIdToSignal = activeContext?.contextId;

    log("🔍", "Child context termination - checking parent:", {
      hasParent: !!contextToSignal,
      hasParentSignal: !!contextToSignal?._onChildSignal,
      childContextId: contextIdToSignal,
    });
  }

  // Signal parent/grandparent if available
  if (contextToSignal?._onChildSignal && contextIdToSignal) {
    log("📡", "Signaling parent/grandparent context:", { contextIdToSignal });
    contextToSignal._onChildSignal(contextIdToSignal);
    // Return never-resolving promise for child contexts, void for parent contexts
    return callerDurableContext ? undefined : new Promise<T>(() => {});
  }

  // Check if there are active operations before terminating (Layer 1)
  const tracker = context.activeOperationsTracker;

  log("🔍", "Active operations check:", {
    hasTracker: !!tracker,
    hasActive: tracker?.hasActive(),
    activeCount: tracker?.getCount(),
  });
  if (tracker && tracker.hasActive()) {
    log("⏳", "Deferring termination - active operations in progress:", {
      activeCount: tracker.getCount(),
      reason,
      message,
    });

    const checkInterval = setInterval(() => {
      if (!tracker.hasActive()) {
        clearInterval(checkInterval);
        log("✅", "Active operations completed, proceeding with termination:", {
          reason,
          message,
        });

        context.terminationManager.terminate({
          reason,
          message,
        });
      }
    }, 10);

    // Return never-resolving promise for child contexts, void for parent contexts
    return callerDurableContext ? undefined : new Promise<T>(() => {});
  }

  // No active operations - terminate immediately
  log("🛑", "Calling terminationManager.terminate:", { reason, message });
  context.terminationManager.terminate({
    reason,
    message,
  });
  log("✅", "terminationManager.terminate called");

  // Return never-resolving promise for child contexts, void for parent contexts
  return callerDurableContext ? undefined : new Promise<T>(() => {});
}

/**
 * Terminates execution for unrecoverable errors and returns a never-resolving promise
 * @param context - The execution context containing the termination manager
 * @param error - The unrecoverable error that caused termination
 * @param stepIdentifier - The step name or ID for error messaging
 * @returns A never-resolving promise
 */
export function terminateForUnrecoverableError<T>(
  context: ExecutionContext,
  error: UnrecoverableError,
  stepIdentifier: string,
): Promise<T> {
  return terminate(
    context,
    error.terminationReason,
    `Unrecoverable error in step ${stepIdentifier}: ${error.message}`,
  );
}
