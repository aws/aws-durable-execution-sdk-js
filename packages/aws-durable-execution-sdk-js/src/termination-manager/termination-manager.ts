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
  TerminationOptions,
  TerminationDetails,
  TerminationResponse,
  TerminationReason,
} from "./types";
import { setCheckpointTerminating } from "../utils/checkpoint/checkpoint";

export class TerminationManager extends EventEmitter {
  private isTerminated = false;
  private terminationDetails?: TerminationDetails;
  private resolveTermination?: (result: TerminationResponse) => void;
  private terminationPromise: Promise<TerminationResponse>;

  constructor() {
    super();
    // Create the promise immediately during construction
    this.terminationPromise = new Promise((resolve) => {
      this.resolveTermination = resolve;
    });
  }

  terminate(options: TerminationOptions = {}): void {
    if (this.isTerminated) return;

    this.isTerminated = true;

    // Set checkpoint termination flag before any other termination logic
    setCheckpointTerminating();

    this.terminationDetails = {
      reason: options.reason ?? TerminationReason.OPERATION_TERMINATED,
      message: options.message ?? "Operation terminated",
      cleanup: options.cleanup,
    };

    // Instead of emitting an event, resolve the promise
    if (this.resolveTermination) {
      this.handleTermination(this.terminationDetails).then(
        this.resolveTermination,
      );
    }
  }

  getTerminationPromise(): Promise<TerminationResponse> {
    return this.terminationPromise;
  }

  private async handleTermination(
    details: TerminationDetails,
  ): Promise<TerminationResponse> {
    if (details.cleanup) {
      try {
        await details.cleanup();
      } catch {}
    }

    return {
      reason: details.reason,
      message: details.message,
    };
  }
}
