/**
 * Error thrown when a step with AT_MOST_ONCE_PER_RETRY semantics was started but interrupted
 * before completion.
 */
export class StepInterruptedError extends Error {
  constructor(stepId: string, stepName?: string) {
    super(
      `The step execution process was initiated but failed to reach completion due to an interruption.`,
    );
    this.name = "StepInterruptedError";
  }
}
