import { OperationType } from "@aws-sdk/client-lambda";
import { OperationSubType } from "./core";
import { OperationLifecycleState } from "./operation-lifecycle-state";

/**
 * Metadata about an operation for lifecycle tracking
 */
export interface OperationMetadata {
  stepId: string;
  name?: string;
  type: OperationType;
  subType: OperationSubType;
  parentId?: string;
}

/**
 * Complete information about an operation's lifecycle state
 */
export interface OperationInfo {
  stepId: string;
  state: OperationLifecycleState;
  metadata: OperationMetadata;
  endTimestamp?: Date;
  timer?: NodeJS.Timeout;
  resolver?: () => void;
  pollCount?: number;
  pollStartTime?: number;
}
