import { InvocationResult } from "../storage/execution-manager";
import { SerializedOperationEvents } from "./operation-event";

export type SerializedInvocationResult = Omit<
  InvocationResult,
  "operationEvents"
> & {
  operationEvents: SerializedOperationEvents[];
};
