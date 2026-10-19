import { performance } from "node:perf_hooks";
import { setTimeout, clearTimeout } from "node:timers";
import { UnrecoverableInvocationError } from "../../errors/unrecoverable-error/unrecoverable-error";
import { TerminationReason } from "../../termination-manager/types";
import type {
  DurableExecutionInvocationOutput,
  ExecutionContext,
} from "../../types/core";
import { MAX_TIMER_DELAY_MS } from "../constants/constants";

// Capture physical timers before a local test runner installs its virtual durable
// clock. Skipping a durable delay must not execute/rearm invocation deadline timers.
const scheduleDeadlineTimer = setTimeout;
const clearDeadlineTimer = clearTimeout;

/** An invocation interruption, never a checkpointed business failure. */
export class InvocationDeadlineError extends UnrecoverableInvocationError {
  readonly terminationReason = TerminationReason.CUSTOM;

  constructor() {
    super("The Lambda invocation deadline has expired");
  }
}

/** Invocation-owned admission, deadline and transport cancellation. */
export class InvocationLifecycle {
  private state: "open" | "closing" | "disposed" = "open";
  private readonly deadline: number;
  private timer?: ReturnType<typeof setTimeout>;
  private deadlineError?: InvocationDeadlineError;
  private readonly controller = new AbortController();
  private readonly cleanup = new Set<() => void>();
  private readonly deadlineCleanup = new Set<
    (error: InvocationDeadlineError) => void
  >();
  private rejectDeadline!: (error: InvocationDeadlineError) => void;
  private readonly expired = new Promise<never>((_, reject) => {
    this.rejectDeadline = reject;
  });

  // The service has already recorded this terminal result. A later timeout while
  // telemetry finishes must not turn it into an abandoned result.
  checkpointedExecutionResult?: DurableExecutionInvocationOutput;

  // A withdrawn checkpoint token cannot be retried. Preserve the service's
  // suspension even if an already-entered telemetry hook outlives the budget.
  serviceRequestedSuspension = false;

  constructor(private readonly remainingTime: () => number) {
    // Runtime time is separate from the virtual durable clock used by skipTime.
    // Global performance/Date can advance by a day while an invocation uses milliseconds.
    this.deadline = performance.now() + this.readRemainingTime();
    // A deadline can expire before run() attaches its race (for example at entry).
    void this.expired.catch(() => undefined);
    this.scheduleDeadline();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  private readRemainingTime(): number {
    const remaining = this.remainingTime();
    return typeof remaining === "number" && !Number.isNaN(remaining)
      ? remaining
      : Infinity;
  }

  private getRemainingTime(): number {
    // Never extend the original budget if the context's clock moves backwards.
    return Math.min(
      this.deadline - performance.now(),
      this.readRemainingTime(),
    );
  }

  private scheduleDeadline(): void {
    if (this.state === "disposed") return;
    const remaining = this.getRemainingTime();
    if (remaining <= 0) {
      this.expire();
    } else if (Number.isFinite(remaining)) {
      this.timer = scheduleDeadlineTimer(
        () => this.scheduleDeadline(),
        Math.min(remaining, MAX_TIMER_DELAY_MS),
      );
      this.timer.unref?.();
    }
  }

  private expire(): void {
    if (this.deadlineError || this.state === "disposed") return;
    this.deadlineError = new InvocationDeadlineError();
    // Publish the invocation error before aborting transports, so their AbortError
    // cannot change the classification of this interruption.
    const cleanup = [...this.deadlineCleanup];
    this.rejectDeadline(this.deadlineError);
    this.dispose();
    // Dispatch before the rejection reaches the caller, after requests/admission
    // have closed. Cleanup never adds an asynchronous wait to an expired invocation.
    for (const callback of cleanup) {
      try {
        callback(this.deadlineError);
      } catch {
        /* Instrumentation cannot replace the deadline. */
      }
    }
  }

  throwIfExpired(): void {
    if (this.state !== "disposed" && this.getRemainingTime() <= 0)
      this.expire();
    if (this.deadlineError) throw this.deadlineError;
  }

  allowsOperations(): boolean {
    if (this.state !== "disposed" && this.getRemainingTime() <= 0)
      this.expire();
    return this.state === "open";
  }

  allowsRequests(): boolean {
    if (this.state !== "disposed" && this.getRemainingTime() <= 0)
      this.expire();
    return this.state !== "disposed";
  }

  closeAdmission(): void {
    if (this.state === "open") this.state = "closing";
  }

  onDeadline(cleanup: (error: InvocationDeadlineError) => void): void {
    if (this.deadlineError) {
      try {
        cleanup(this.deadlineError);
      } catch {
        /* Preserve the original deadline. */
      }
    } else if (this.state !== "disposed") {
      this.deadlineCleanup.add(cleanup);
    }
  }

  onDispose(cleanup: () => void): void {
    if (this.state === "disposed") cleanup();
    else this.cleanup.add(cleanup);
  }

  dispose(): void {
    if (this.state === "disposed") return;
    this.state = "disposed";
    clearDeadlineTimer(this.timer);
    this.timer = undefined;
    this.controller.abort();
    for (const cleanup of this.cleanup) cleanup();
    this.cleanup.clear();
    this.deadlineCleanup.clear();
  }

  async run<T>(action: () => Promise<T>): Promise<T> {
    this.throwIfExpired();
    const result = await Promise.race([action(), this.expired]);
    // A synchronous handler or a long microtask chain can delay the timer callback.
    this.throwIfExpired();
    return result;
  }
}

/**
 * Leave closed invocation stacks suspended, as for an ordinary durable wait. Throwing
 * here would run customer catch/finally or checkpoint a business failure on replay.
 * Guard the callback itself: a plugin can defer invoking it until after disposal.
 */
export function runInvocationCallback<T>(
  context: ExecutionContext,
  callback: () => Promise<T>,
): Promise<T> {
  const lifecycle = context.invocationLifecycle;
  if (lifecycle && !lifecycle.allowsOperations()) return new Promise(() => {});
  return Promise.resolve(callback()).then(
    (result) =>
      lifecycle && !lifecycle.allowsOperations()
        ? new Promise<T>(() => {})
        : result,
    (error: unknown) => {
      if (lifecycle && !lifecycle.allowsOperations())
        return new Promise<T>(() => {});
      throw error;
    },
  );
}
