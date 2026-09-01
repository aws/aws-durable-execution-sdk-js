import { Tagged } from "../../types";
import { randomUUID } from "node:crypto";

export type ExecutionId = Tagged<string, "ExecutionId">;
/**
 * @param param a string to convert to an ExecutionId type
 * @returns a tagged string used for identifying an ExecutionId
 */
export function createExecutionId(param?: string): ExecutionId {
  return typeof param === "string"
    ? (param as ExecutionId)
    : (randomUUID() as ExecutionId);
}

export type InvocationId = Tagged<string, "InvocationId">;
/**
 * @param param a string to convert to an InvocationId type
 * @returns a tagged string used for identifying an InvocationId
 */
export function createInvocationId(param?: string): InvocationId {
  return typeof param === "string"
    ? (param as InvocationId)
    : (randomUUID() as InvocationId);
}

export type CheckpointToken = Tagged<string, "CheckpointToken">;
/**
 * @param param a string to convert to a CheckpointToken type
 * @returns a tagged string used for identifying a CheckpointToken
 */
export function createCheckpointToken(param: string): CheckpointToken {
  return param as CheckpointToken;
} // CheckpointTokenData encoded as a base64 string

export type CallbackId = Tagged<string, "CallbackId">;
export function createCallbackId(param: string): CallbackId {
  return param as CallbackId;
}
