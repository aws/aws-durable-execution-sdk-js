export enum TerminationReason {
  // Default termination reason
  OPERATION_TERMINATED = "OPERATION_TERMINATED",

  // Retry-related reasons
  RETRY_SCHEDULED = "RETRY_SCHEDULED",
  RETRY_INTERRUPTED_STEP = "RETRY_INTERRUPTED_STEP",

  // Wait-related reasons
  WAIT_SCHEDULED = "WAIT_SCHEDULED",

  // Callback-related reasons
  CALLBACK_PENDING = "CALLBACK_PENDING",

  // Error-related reasons
  CHECKPOINT_FAILED = "CHECKPOINT_FAILED",

  // Custom reason
  CUSTOM = "CUSTOM",
}

export interface TerminationResponse {
  reason: TerminationReason;
  message: string;
}

export interface TerminationOptions {
  reason?: TerminationReason;
  message?: string;
  cleanup?: () => Promise<void>;
}

export interface TerminationDetails extends TerminationResponse {
  cleanup?: () => Promise<void>;
}
