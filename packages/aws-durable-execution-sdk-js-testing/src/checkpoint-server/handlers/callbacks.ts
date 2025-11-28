import { ErrorObject } from "@aws-sdk/client-lambda";
import { createCallbackId } from "../utils/tagged-strings";
import { CompleteCallbackStatus } from "../storage/callback-manager";
import { ExecutionManager } from "../storage/execution-manager";

export function processCallbackFailure(
  callbackIdParam: string,
  input: ErrorObject | undefined,
  executionManager: ExecutionManager,
): Record<string, never> {
  const callbackId = createCallbackId(callbackIdParam);
  const storage = executionManager.getCheckpointsByCallbackId(callbackId);

  if (!storage) {
    throw new Error("Execution not found");
  }

  storage.completeCallback(
    {
      CallbackId: callbackId,
      Error: input ?? {},
    },
    CompleteCallbackStatus.FAILED,
  );

  return {};
}

export function processCallbackSuccess(
  callbackIdParam: string,
  input: Buffer,
  executionManager: ExecutionManager,
): Record<string, never> {
  const callbackId = createCallbackId(callbackIdParam);
  const storage = executionManager.getCheckpointsByCallbackId(callbackId);

  if (!storage) {
    throw new Error("Execution not found");
  }

  if (!Buffer.isBuffer(input)) {
    throw new Error("Invalid buffer input");
  }

  const result = input.byteLength !== 0 ? input.toString("utf-8") : undefined;

  storage.completeCallback(
    {
      CallbackId: callbackId,
      Result: result,
    },
    CompleteCallbackStatus.SUCCEEDED,
  );

  return {};
}

export function processCallbackHeartbeat(
  callbackIdParam: string,
  executionManager: ExecutionManager,
): Record<string, never> {
  const callbackId = createCallbackId(callbackIdParam);
  const storage = executionManager.getCheckpointsByCallbackId(callbackId);

  if (!storage) {
    throw new Error("Execution not found");
  }

  storage.heartbeatCallback(callbackId);

  return {};
}
