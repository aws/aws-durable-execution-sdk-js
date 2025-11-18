import { DurablePromise } from "../../../types";
import { DurableExecutionMode } from "../../../types/core";

export class ModeManagement {
  constructor(
    private captureExecutionState: () => boolean,
    private checkAndUpdateReplayMode: () => void,
    private checkForNonResolvingPromise: () => Promise<never> | null,
    private getDurableExecutionMode: () => DurableExecutionMode,
    private setDurableExecutionMode: (mode: DurableExecutionMode) => void,
  ) {}

  withModeManagement<T>(operation: () => Promise<T>): Promise<T> {
    const shouldSwitchToExecutionMode = this.captureExecutionState();

    this.checkAndUpdateReplayMode();
    const nonResolvingPromise = this.checkForNonResolvingPromise();
    if (nonResolvingPromise) return nonResolvingPromise;

    try {
      return operation();
    } finally {
      if (shouldSwitchToExecutionMode) {
        this.setDurableExecutionMode(DurableExecutionMode.ExecutionMode);
      }
    }
  }

  withDurableModeManagement<T>(
    operation: () => DurablePromise<T>,
  ): DurablePromise<T> {
    const shouldSwitchToExecutionMode = this.captureExecutionState();

    this.checkAndUpdateReplayMode();
    const nonResolvingPromise = this.checkForNonResolvingPromise();
    if (nonResolvingPromise) {
      return new DurablePromise(async () => {
        await nonResolvingPromise;
        // This will never be reached
        throw new Error("Unreachable code");
      });
    }

    try {
      return operation();
    } finally {
      if (shouldSwitchToExecutionMode) {
        this.setDurableExecutionMode(DurableExecutionMode.ExecutionMode);
      }
    }
  }
}
