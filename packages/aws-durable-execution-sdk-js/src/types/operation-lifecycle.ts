import { OperationType } from "./wire";
import { OperationSubType } from "./core";
import { OperationLifecycleState } from "./operation-lifecycle-state";

/**
 * Metadata about an operation for lifecycle tracking
 */
export interface OperationMetadata {
  stepId: string;
  name?: string | undefined;
  type: OperationType;
  subType: OperationSubType;
  parentId?: string | undefined;
}

/**
 * Complete information about an operation's lifecycle state
 */
export interface OperationInfo {
  stepId: string;
  state: OperationLifecycleState;
  metadata: OperationMetadata;
  endTimestamp?: Date | undefined;
  timer?: NodeJS.Timeout | undefined;
  resolver?: (() => void) | undefined;
  pollCount?: number | undefined;
}
