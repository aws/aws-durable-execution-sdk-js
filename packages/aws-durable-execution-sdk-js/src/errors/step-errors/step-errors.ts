/**
 * Error thrown when a step with AT_MOST_ONCE_PER_RETRY semantics was started but interrupted
 * before completion.
 * @public
 */
export class StepInterruptedError extends Error {
  constructor(_stepId: string, _stepName?: string) {
    super(
      `The step execution process was initiated but failed to reach completion due to an interruption.`,
    );
    this.name = "StepInterruptedError";
  }
}
