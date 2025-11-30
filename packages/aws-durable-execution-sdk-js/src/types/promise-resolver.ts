/**
 * Promise resolver for centralized termination management
 */
export interface PromiseResolver<T> {
  handlerId: string;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  scheduledTime?: number;
  metadata?: Record<string, any>;
}

/**
 * Extended checkpoint manager interface for promise resolver management
 */
export interface CentralizedCheckpointManager {
  // Promise resolver management
  scheduleResume<T>(resolver: PromiseResolver<T>): void;
  resolvePromise(handlerId: string, value: any): void;
  rejectPromise(handlerId: string, error: Error): void;

  // Termination logic
  checkTermination(): void;
  startTerminationWarmup(): void;
  cancelTerminationWarmup(): void;

  // Handler tracking
  getActiveHandlerCount(): number;
  hasActiveHandlers(): boolean;
}
