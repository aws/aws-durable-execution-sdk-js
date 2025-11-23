import { ExecutionContext } from "./core";
import { TerminationReason } from "../termination-manager/types";

/**
 * Type for termination function
 */
export type TerminationFunction = <T>(
  context: ExecutionContext,
  reason: TerminationReason,
  message: string,
) => Promise<T>;
