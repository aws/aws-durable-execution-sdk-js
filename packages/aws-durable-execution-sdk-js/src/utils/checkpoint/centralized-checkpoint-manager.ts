import { CheckpointManager } from "./checkpoint-manager";
import { PromiseResolver } from "../../types/promise-resolver";
import { log } from "../logger/logger";
import { TerminationReason } from "../../termination-manager/types";
import { DurableExecutionClient } from "../../types/durable-execution";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { EventEmitter } from "events";
import { DurableLogger } from "../../types/durable-logger";
import { Operation } from "@aws-sdk/client-lambda";

interface ActiveOperationsTracker {
  increment(): void;
  decrement(): void;
}

/**
 * Extended checkpoint manager with centralized promise resolver management
 */
export class CentralizedCheckpointManager extends CheckpointManager {
  private promiseResolvers = new Map<string, PromiseResolver<any>>();
  private timers = new Map<string, NodeJS.Timeout>();
  private terminationWarmupTimer?: NodeJS.Timeout;
  private readonly WARMUP_DURATION = 2000; // 2 seconds

  constructor(
    durableExecutionArn: string,
    stepData: Record<string, Operation>,
    storage: DurableExecutionClient,
    terminationManager: TerminationManager,
    activeOperationsTracker: ActiveOperationsTracker | undefined,
    initialTaskToken: string,
    stepDataEmitter: EventEmitter,
    logger: DurableLogger,
    pendingCompletions: Set<string>,
  ) {
    super(
      durableExecutionArn,
      stepData,
      storage,
      terminationManager,
      activeOperationsTracker,
      initialTaskToken,
      stepDataEmitter,
      logger,
      pendingCompletions,
    );
  }

  /**
   * Schedule a promise to be resolved later by the checkpoint manager
   */
  scheduleResume<T>(resolver: PromiseResolver<T>): void;
  /**
   * Schedule a promise to be resolved later by the checkpoint manager (direct parameters)
   */
  scheduleResume<T>(
    handlerId: string,
    resolve: (value: T) => void,
    reject: (reason?: any) => void,
    scheduledTime: number,
  ): void;
  scheduleResume<T>(
    resolverOrHandlerId: PromiseResolver<T> | string,
    resolve?: (value: T) => void,
    reject?: (reason?: any) => void,
    scheduledTime?: number,
  ): void {
    let resolver: PromiseResolver<T>;

    if (typeof resolverOrHandlerId === "string") {
      // Direct parameters
      resolver = {
        handlerId: resolverOrHandlerId,
        resolve: resolve!,
        reject: reject!,
        scheduledTime: scheduledTime!,
      };
    } else {
      // PromiseResolver object
      resolver = resolverOrHandlerId;
    }

    const { handlerId, scheduledTime: schedTime } = resolver;

    log("📋", `Scheduling resume for handler ${handlerId}`, {
      handlerId,
      scheduledTime: schedTime
        ? new Date(schedTime).toISOString()
        : "immediate",
    });

    // Store the resolver
    this.promiseResolvers.set(handlerId, resolver);

    // Cancel any existing timer for this handler
    this.cancelTimer(handlerId);

    // Cancel termination warmup since we have active work
    this.cancelTerminationWarmup();

    if (schedTime && schedTime > Date.now()) {
      // Schedule timer for future resolution
      const delay = schedTime - Date.now();
      this.scheduleTimer(handlerId, delay);
    } else {
      // Resolve immediately
      this.resolvePromise(handlerId, undefined);
    }
  }

  /**
   * Resolve a promise by handler ID
   */
  resolvePromise(handlerId: string, value: any): void {
    const resolver = this.promiseResolvers.get(handlerId);
    if (resolver) {
      log("✅", `Resolving promise for handler ${handlerId}`);
      resolver.resolve(value);
      this.promiseResolvers.delete(handlerId);
      this.cancelTimer(handlerId);
      this.checkTermination();
    }
  }

  /**
   * Reject a promise by handler ID
   */
  rejectPromise(handlerId: string, error: Error): void {
    const resolver = this.promiseResolvers.get(handlerId);
    if (resolver) {
      log("❌", `Rejecting promise for handler ${handlerId}`, error);
      resolver.reject(error);
      this.promiseResolvers.delete(handlerId);
      this.cancelTimer(handlerId);
      this.checkTermination();
    }
  }

  /**
   * Schedule a timer to resolve a handler after a delay
   */
  private scheduleTimer(handlerId: string, delay: number): void {
    log("⏰", `Scheduling timer for handler ${handlerId} in ${delay}ms`);

    const timer = setTimeout(() => {
      log("🔔", `Timer fired for handler ${handlerId}`);
      this.resolvePromise(handlerId, undefined);
    }, delay);

    this.timers.set(handlerId, timer);
  }

  /**
   * Cancel a timer for a specific handler
   */
  private cancelTimer(handlerId: string): void {
    const timer = this.timers.get(handlerId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(handlerId);
      log("⏹️", `Cancelled timer for handler ${handlerId}`);
    }
  }

  /**
   * Check if termination should be initiated
   */
  checkTermination(): void {
    const hasActiveHandlers = this.hasActiveHandlers();

    log("🔍", `Checking termination`, {
      activeHandlers: this.getActiveHandlerCount(),
      hasActiveHandlers,
    });

    if (!hasActiveHandlers) {
      this.startTerminationWarmup();
    }
  }

  /**
   * Start termination warmup period
   */
  startTerminationWarmup(): void {
    if (this.terminationWarmupTimer) {
      log("⏳", "Termination warmup already in progress");
      return;
    }

    log("🔥", `Starting termination warmup (${this.WARMUP_DURATION}ms)`);

    this.terminationWarmupTimer = setTimeout(() => {
      // Double-check no new handlers appeared during warmup
      if (!this.hasActiveHandlers()) {
        log("🛑", "Warmup completed - initiating termination");
        this.initiateTermination();
      } else {
        log(
          "🔄",
          "New handlers appeared during warmup - cancelling termination",
        );
      }
      this.terminationWarmupTimer = undefined;
    }, this.WARMUP_DURATION);
  }

  /**
   * Cancel termination warmup
   */
  cancelTerminationWarmup(): void {
    if (this.terminationWarmupTimer) {
      log("❌", "Cancelling termination warmup - new activity detected");
      clearTimeout(this.terminationWarmupTimer);
      this.terminationWarmupTimer = undefined;
    }
  }

  /**
   * Get count of active handlers
   */
  getActiveHandlerCount(): number {
    return this.promiseResolvers.size;
  }

  /**
   * Check if there are active handlers
   */
  hasActiveHandlers(): boolean {
    return this.promiseResolvers.size > 0;
  }

  /**
   * Initiate termination when all handlers are idle
   */
  private initiateTermination(): void {
    // For now, just log - will integrate with actual termination manager
    log("🛑", "All handlers idle - would initiate termination here");

    // TODO: Integrate with termination manager
    // this.terminationManager.terminate({
    //   reason: TerminationReason.OPERATION_TERMINATED,
    //   message: "All handlers completed or idle"
    // });
  }

  /**
   * Override setTerminating to clean up resolvers
   */
  setTerminating(): void {
    try {
      super.setTerminating();
    } catch {
      // Parent method might not exist, ignore
    }

    // Cancel all timers
    for (const [handlerId] of Array.from(this.timers.entries())) {
      this.cancelTimer(handlerId);
    }

    // Cancel warmup
    this.cancelTerminationWarmup();

    log("🛑", "Checkpoint manager set to terminating state");
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    // Cancel all timers
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();

    // Cancel warmup
    this.cancelTerminationWarmup();

    // Clear resolvers
    this.promiseResolvers.clear();

    log("🧹", "Centralized checkpoint manager cleaned up");
  }
}
