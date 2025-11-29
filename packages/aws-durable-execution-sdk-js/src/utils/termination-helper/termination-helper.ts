import { ExecutionContext } from "../../types";
import { UnrecoverableError } from "../../errors/unrecoverable-error/unrecoverable-error";
import { TerminationReason } from "../../termination-manager/types";
import { log } from "../logger/logger";
import { getActiveContext } from "../context-tracker/context-tracker";
import { Operation, OperationStatus } from "@aws-sdk/client-lambda";
import { hashId } from "../step-id-utils/step-id-utils";

/**
 * Checks if any ancestor operation in the parent chain has finished (SUCCEEDED or FAILED)
 * or has a pending completion checkpoint
 */
function hasFinishedAncestor(
  context: ExecutionContext,
  parentId?: string,
): boolean {
  if (!parentId) {
    log("🔍", "hasFinishedAncestor: No parentId provided");
    return false;
  }

  // First check if any ancestor has a pending completion checkpoint
  if (hasPendingAncestorCompletion(context, parentId)) {
    log("🔍", "hasFinishedAncestor: Found ancestor with pending completion!", {
      parentId,
    });
    return true;
  }

  let currentHashedId: string | undefined = hashId(parentId);
  log("🔍", "hasFinishedAncestor: Starting check", {
    parentId,
    initialHashedId: currentHashedId,
  });

  while (currentHashedId) {
    const parentOperation: Operation | undefined =
      context._stepData[currentHashedId];

    log("🔍", "hasFinishedAncestor: Checking operation", {
      hashedId: currentHashedId,
      hasOperation: !!parentOperation,
      status: parentOperation?.Status,
      type: parentOperation?.Type,
    });

    if (
      parentOperation?.Status === OperationStatus.SUCCEEDED ||
      parentOperation?.Status === OperationStatus.FAILED
    ) {
      log("🔍", "hasFinishedAncestor: Found finished ancestor!", {
        hashedId: currentHashedId,
        status: parentOperation.Status,
      });
      return true;
    }

    currentHashedId = parentOperation?.ParentId;
  }

  log("🔍", "hasFinishedAncestor: No finished ancestor found");
  return false;
}

/**
 * Checks if any ancestor has a pending completion checkpoint
 */
function hasPendingAncestorCompletion(
  context: ExecutionContext,
  stepId: string,
): boolean {
  let currentHashedId: string | undefined = hashId(stepId);

  while (currentHashedId) {
    if (context.pendingCompletions.has(currentHashedId)) {
      return true;
    }

    const operation: Operation | undefined = context._stepData[currentHashedId];
    currentHashedId = operation?.ParentId;
  }

  return false;
}

/**
 * Terminates execution and returns a never-resolving promise to prevent code progression
 * @param context - The execution context containing the termination manager
 * @param reason - The termination reason
 * @param message - The termination message
 * @returns A never-resolving promise
 */
export function terminate<T>(
  context: ExecutionContext,
  reason: TerminationReason,
  message: string,
): Promise<T> {
  const activeContext = getActiveContext();

  // If we have a parent context, check ancestors before terminating
  if (activeContext?.parentId) {
    return new Promise<T>((_resolve, _reject) => {
      log("🔍", "Terminate called - checking context:", {
        hasActiveContext: !!activeContext,
        contextId: activeContext?.contextId,
        parentId: activeContext?.parentId,
        reason,
        message,
      });

      const ancestorFinished = hasFinishedAncestor(
        context,
        activeContext.parentId,
      );
      log("🔍", "Ancestor check result:", {
        parentId: activeContext.parentId,
        ancestorFinished,
      });

      if (ancestorFinished) {
        log("🛑", "Skipping termination - ancestor already finished:", {
          contextId: activeContext.contextId,
          parentId: activeContext.parentId,
          reason,
          message,
        });
        // Return never-resolving promise without terminating
        return;
      }

      // Terminate - checkpoint coordination handled in waitBeforeContinue
      context.terminationManager.terminate({
        reason,
        message,
      });
    });
  }

  // No parent context - terminate, checkpoint coordination handled in waitBeforeContinue
  context.terminationManager.terminate({
    reason,
    message,
  });

  return new Promise<T>(() => {});
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
