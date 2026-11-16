/*
Second Approach (Promise-based):
Pros:
  - Simpler implementation
  - Single promise instance for the entire lifecycle
  - More memory efficient as it doesn't create new promises on each getTerminationPromise() call
  - More predictable behavior since there's only one resolution path
Cons:
  - Less flexible as it doesn't support multiple listeners
  - Once the promise is resolved, it stays resolved (can't be reset)
  - Doesn't leverage Node.js's event system
*/

import { EventEmitter } from "events";
import {
  type TerminationOptions,
  type TerminationDetails,
  type TerminationResponse,
  TerminationReason,
} from "./types";

export class TerminationManager extends EventEmitter {
  private isTerminated = false;
  private terminationDetails?: TerminationDetails;
  private resolveTermination?: (result: TerminationResponse) => void;
  private terminationPromise: Promise<TerminationResponse>;
  private setCheckpointTerminating?: (() => void) | undefined;

  constructor(setCheckpointTerminating?: () => void) {
    super();
    this.setCheckpointTerminating = setCheckpointTerminating;
    // Create the promise immediately during construction
    this.terminationPromise = new Promise((resolve) => {
      this.resolveTermination = resolve;
    });
  }

  setCheckpointTerminatingCallback(callback: () => void): void {
    this.setCheckpointTerminating = callback;
  }

  terminate(options: TerminationOptions = {}): void {
    if (this.isTerminated) return;

    // Set first: the callback below aborts the invocation's signal, and an abort listener
    // that starts an operation must already see the invocation as terminated.
    this.isTerminated = true;

    // Set checkpoint termination flag before any other termination logic
    this.setCheckpointTerminating?.();

    this.terminationDetails = {
      reason: options.reason ?? TerminationReason.OPERATION_TERMINATED,
      message: options.message ?? "Operation terminated",
      error: options.error,
    };

    // Instead of emitting an event, resolve the promise
    if (this.resolveTermination) {
      // handleTermination does not reject.
      void this.handleTermination(this.terminationDetails).then(
        this.resolveTermination,
      );
    }
  }

  /** Whether `terminate` was called for this invocation. */
  isTerminationRequested(): boolean {
    return this.isTerminated;
  }

  getTerminationPromise(): Promise<TerminationResponse> {
    return this.terminationPromise;
  }

  private async handleTermination(
    details: TerminationDetails,
  ): Promise<TerminationResponse> {
    return {
      reason: details.reason,
      message: details.message,
      error: details.error,
    };
  }
}
