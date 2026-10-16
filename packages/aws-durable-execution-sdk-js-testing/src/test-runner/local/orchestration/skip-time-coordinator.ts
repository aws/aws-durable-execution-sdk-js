import { Clock } from "@sinonjs/fake-timers";
import { defaultLogger } from "../../../logger";

/**
 * One execution's view of the fake clock, as seen by {@link SkipTimeCoordinator}.
 */
export interface SkipTimeParticipant {
  /**
   * Whether the execution has an invocation running or about to start. While any
   * participant is busy, the fake clock is not advanced.
   */
  isBusy(): boolean;
  /**
   * Whether the execution still waits for something outside an invocation: a wait or
   * retry end, a callback, or a durable invoke. False once the execution has finished.
   */
  hasPendingWork(): boolean;
  /** The earliest wait or retry end not yet applied, on the fake clock. */
  earliestDeadline(): number | undefined;
  /**
   * Completes the operations that end by `deadlineMs`, and starts the invocation they
   * release. Called after the fake clock has reached `deadlineMs`.
   */
  applyDeadline(deadlineMs: number): void;
  /**
   * Called after the fake clock has moved. Completes the operations whose end the clock
   * has now reached, and re-arms the real timer for the next end.
   */
  onClockAdvanced(): void;
}

/**
 * Advances a fake clock shared by several executions, one wait or retry end at a time.
 *
 * With skipTime, every LocalDurableTestRunner reads the same fake clock, including the
 * runners that durable invokes start. The clock may move to an end only when no execution
 * has anything to run before that end. So the coordinator advances the clock only when no
 * participant is busy, and only to the earliest end across all of them. The participant
 * that owns that end applies it, which makes it busy until its invocation has run.
 *
 * An execution waiting for a durable invoke is not busy while the invoked function runs,
 * because the invoked function may need the clock to advance. But once the invoked
 * function has finished, its caller must resume before the clock moves: the invoked
 * function's result is still on its way back to it. So the coordinator tracks each invoke
 * separately, from {@link startInvoke} until the caller has queued the invocation that
 * resumes it. The clock does not advance while a tracked invoke's invoked function is idle
 * without pending work, which means it has finished. It also does not advance while a
 * tracked invoke has no invoked participant, as with a non-durable function, which runs
 * outside the clock. Pending work elsewhere does not lift this, because it is not the
 * result on its way back. When a caller finishes without an invoke's result, as when a
 * parallel completes without that branch, its invokes stop holding the clock.
 *
 * Advancing past an earlier end would let work resuming at that end start its next delay
 * from the later one.
 */
export class SkipTimeCoordinator {
  private static readonly coordinators = new WeakMap<
    Clock,
    SkipTimeCoordinator
  >();

  private readonly participants = new Set<SkipTimeParticipant>();
  /** Every invoke between {@link startInvoke} and its `end()`. */
  private readonly invokes = new Set<InvokeHandoff>();
  /** The invoke being started, which a participant registering now belongs to. */
  private startingInvoke: InvokeHandoff | undefined;

  private constructor(private readonly clock: Clock) {}

  /** @returns the coordinator for every execution that shares `clock` */
  static forClock(clock: Clock): SkipTimeCoordinator {
    let coordinator = this.coordinators.get(clock);
    if (!coordinator) {
      coordinator = new SkipTimeCoordinator(clock);
      this.coordinators.set(clock, coordinator);
    }
    return coordinator;
  }

  register(participant: SkipTimeParticipant): void {
    this.participants.add(participant);
    if (this.startingInvoke && !this.startingInvoke.invoked) {
      this.startingInvoke.invoked = participant;
    }
  }

  /**
   * Removes a finished execution, and lets the others advance without it. The invokes it
   * still waited for no longer hold the clock: no caller remains to resume with their
   * results.
   */
  unregister(participant: SkipTimeParticipant): void {
    this.participants.delete(participant);
    for (const invoke of this.invokes) {
      if (invoke.caller === participant) {
        this.invokes.delete(invoke);
      }
    }
    this.advance();
  }

  /**
   * Tracks one durable invoke until its caller has queued the invocation that resumes it.
   *
   * `start` must create the invoked function's runner synchronously. The participant that
   * registers during `start` is the invoked function. If none registers, the invoked
   * function runs outside the clock, and the clock does not advance until `end()`, or until
   * `caller` unregisters.
   *
   * @param caller the execution waiting for the invoke's result
   * @returns the promise `start` returned, and `end()`, which the caller must call once
   * the invocation that resumes it is queued, or once the invoke has failed
   */
  startInvoke<T>(
    caller: SkipTimeParticipant,
    start: () => Promise<T>,
  ): {
    result: Promise<T>;
    end: () => void;
  } {
    if (!this.participants.has(caller)) {
      // The caller has finished, as when the final checkpoint drain delivers the START of
      // an invoke the handler did not await. No caller remains to resume with the result,
      // and nothing would remove the hold once its caller has unregistered.
      let result: Promise<T>;
      try {
        result = start();
      } catch (err) {
        result = Promise.reject(err);
      }
      return { result, end: () => undefined };
    }
    const invoke: InvokeHandoff = { caller, invoked: undefined };
    this.invokes.add(invoke);
    this.startingInvoke = invoke;
    let result: Promise<T>;
    try {
      result = start();
    } catch (err) {
      result = Promise.reject(err);
    } finally {
      this.startingInvoke = undefined;
    }
    if (!invoke.invoked) {
      // Expected for a non-durable function. For a durable function, its runner did not
      // register before the invoke's first await, so its waits would take real time.
      defaultLogger.debug(
        "No runner registered while starting an invoke. The fake clock stays until the caller resumes.",
      );
    }
    return {
      result,
      end: () => {
        // Idempotent: a caller can end a hold after its context has already released it.
        if (this.invokes.delete(invoke)) {
          this.advance();
        }
      },
    };
  }

  /**
   * Advances the clock to the earliest pending end and applies it, if nothing has to run
   * first. Call whenever a participant becomes idle or gains a pending end.
   */
  advance(): void {
    const participants = [...this.participants];
    if (participants.some((participant) => participant.isBusy())) {
      return;
    }

    for (const invoke of this.invokes) {
      // An invoked function that is idle without pending work has finished, even if it
      // has not unregistered yet. Its result is on its way back to its caller. Without an
      // invoked participant, the invoked function runs outside the clock.
      if (!invoke.invoked?.hasPendingWork()) {
        return;
      }
    }

    let earliest: { participant: SkipTimeParticipant; deadlineMs: number } =
      undefined as never;
    for (const participant of participants) {
      const deadlineMs = participant.earliestDeadline();
      if (
        deadlineMs !== undefined &&
        (earliest === undefined || deadlineMs < earliest.deadlineMs)
      ) {
        earliest = { participant, deadlineMs };
      }
    }
    if (earliest === undefined) {
      return;
    }

    // No invocation is running, so no SDK timer is pending: a tick only moves Date.now()
    // forward, and fires any timer the test itself has set.
    const advanceMs = earliest.deadlineMs - Date.now();
    if (advanceMs > 0) {
      defaultLogger.debug(`Advancing fake clock by ${advanceMs}ms`);
      this.clock.tick(advanceMs);
    }
    earliest.participant.applyDeadline(earliest.deadlineMs);

    // Every real timer armed for a later end was computed before the jump, so it would
    // fire too late by the length of the jump. Re-arm them all.
    for (const participant of participants) {
      participant.onClockAdvanced();
    }
  }
}

/** One durable invoke tracked by {@link SkipTimeCoordinator.startInvoke}. */
interface InvokeHandoff {
  /** The execution waiting for the invoke's result. */
  caller: SkipTimeParticipant;
  /** The invoked function's execution, if it runs on the clock. */
  invoked: SkipTimeParticipant | undefined;
}
