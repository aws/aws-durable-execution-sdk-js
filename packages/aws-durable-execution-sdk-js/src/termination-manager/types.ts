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
  CONFIG_VALIDATION_ERROR = "CONFIG_VALIDATION_ERROR",
  NON_DETERMINISM = "NON_DETERMINISM",

  // Custom reason
  CUSTOM = "CUSTOM",
}

/**
 * Whether a termination means this invocation is done for now and the execution continues
 * later, or that the execution has hit something it cannot continue past.
 *
 * A suspend is a wait, a scheduled retry, or a pending callback: the invocation answers
 * PENDING and the service invokes again. A fault answers FAILED, carrying the error.
 */
export type TerminationClass = "suspend" | "fault";

/**
 * The class of every termination reason.
 *
 * Exhaustive by construction: `Record<TerminationReason, ...>` makes adding a reason
 * without classifying it a compile error. That signal is the point of keeping this beside
 * the enum -- a classification living in the consumer cannot tell anyone adding a reason
 * here that they have left it unclassified, which is the very omission the fault default
 * below exists to contain.
 *
 * CHECKPOINT_FAILED and SERDES_FAILED are faults, though in practice the invocation
 * handles both before consulting this map: they rethrow, failing the invocation rather
 * than the execution.
 */
export const TERMINATION_CLASS: Record<TerminationReason, TerminationClass> = {
  [TerminationReason.OPERATION_TERMINATED]: "suspend",
  [TerminationReason.RETRY_SCHEDULED]: "suspend",
  [TerminationReason.RETRY_INTERRUPTED_STEP]: "suspend",
  [TerminationReason.WAIT_SCHEDULED]: "suspend",
  [TerminationReason.CALLBACK_PENDING]: "suspend",
  [TerminationReason.CHECKPOINT_FAILED]: "fault",
  [TerminationReason.SERDES_FAILED]: "fault",
  [TerminationReason.CONTEXT_VALIDATION_ERROR]: "fault",
  [TerminationReason.CONFIG_VALIDATION_ERROR]: "fault",
  [TerminationReason.NON_DETERMINISM]: "fault",
  // Deliberately unclassified in meaning: CUSTOM says nothing about whether the execution
  // can continue, so it is treated as a fault. Reporting a fault that was really a suspend
  // costs one failed execution; the reverse asks the service to retry something that can
  // never progress, and hides the error while doing so.
  [TerminationReason.CUSTOM]: "fault",
};

/**
 * Classifies a termination reason, defaulting to `"fault"`.
 *
 * The default is not reachable through the enum -- the map above is exhaustive -- but is
 * kept because `reason` crosses a boundary where a value outside the enum can arrive as a
 * plain string, and answering PENDING for something unrecognised is the outcome worth
 * ruling out.
 */
export const classifyTermination = (
  reason: TerminationReason,
): TerminationClass =>
  (TERMINATION_CLASS as Partial<Record<TerminationReason, TerminationClass>>)[
    reason
  ] ?? "fault";

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
