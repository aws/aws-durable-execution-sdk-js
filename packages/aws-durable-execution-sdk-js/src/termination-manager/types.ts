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
  SERDES_FAILED = "SERDES_FAILED",
  CONTEXT_VALIDATION_ERROR = "CONTEXT_VALIDATION_ERROR",

  // Custom reason
  CUSTOM = "CUSTOM",
}

export interface TerminationResponse {
  reason: TerminationReason;
  message: string;
  error?: Error;
}

export interface TerminationOptions {
  reason?: TerminationReason;
  message?: string;
  error?: Error;
  cleanup?: () => Promise<void>;
}

export interface TerminationDetails extends TerminationResponse {
  cleanup?: () => Promise<void>;
}
