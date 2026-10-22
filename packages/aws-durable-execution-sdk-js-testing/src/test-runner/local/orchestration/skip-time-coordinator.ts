import { Clock } from "@sinonjs/fake-timers";
import { defaultLogger } from "../../../logger";
import { realSetTimeout } from "../real-timers/real-timers";

/**
 * How long, in real time, the clock waits for a running non-durable invoked function.
 *
 * A non-durable function runs outside the clock. While it runs, the clock does not advance,
 * so its result reaches the caller before a later wait or retry end. But the runner cannot
 * see whether the handler still awaits the result. A promise combinator such as
 * `context.promise.race` stops awaiting its other operands, and a handler may never await
 * an invoke at all. If such a function never returns, the clock would never advance again.
 * So the clock waits for the function only this long. After that, the clock may advance
 * before the function's result arrives.
 */
export const NON_DURABLE_INVOKE_HOLD_MS = 1000;

/**
 * How long, in real time, the clock waits for one running invocation of a durable invoked
 * function.
 *
 * A durable invoked function runs in its own runner. While an invocation of it runs, the
 * clock does not advance, so the work it does reaches its caller before a later end. But,
 * as for a non-durable function, the runner cannot see whether the handler still awaits the
 * invoke. `context.promise.race`, `context.promise.any`, and a handler that never awaits an
 * invoke all leave it running unobserved. If its step never settles, the clock would never
 * advance again. So the clock waits for each invocation of it only this long. After that,
 * the clock may advance while the invocation still runs.
 */
export const DURABLE_INVOKE_HOLD_MS = NON_DURABLE_INVOKE_HOLD_MS;

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
   * A number that identifies the invocation running now, or undefined while none runs.
   * Each invocation gets a new number. The execution can be busy without one running, while
   * an invocation is queued to start.
   */
  runningInvocation(): number | undefined;
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
 * outside the clock, for up to {@link NON_DURABLE_INVOKE_HOLD_MS} of real time. Pending
 * work elsewhere does not lift this, because it is not the result on its way back. When a
 * caller finishes without an invoke's result, as when a parallel completes without that
 * branch, its invokes stop holding the clock. Once a non-durable function returns, its
 * result holds the clock until the caller has queued the invocation that resumes it.
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
  /**
   * Executions whose caller no longer waits for them. See {@link detach}. Their waits and
   * retries still skip time, but they never stop the clock from advancing.
   */
  private readonly detached = new Set<SkipTimeParticipant>();
  /** Every invoke between {@link startInvoke} and its `end()`. */
  private readonly invokes = new Set<InvokeHandoff>();
  /** The invoke being started, which a participant registering now belongs to. */
  private startingInvoke: InvokeHandoff | undefined;
  /** Whether an invoke from a caller that no one waits for is being started. */
  private startingDetachedInvoke = false;
  /**
   * Every invoked function's runner that is still a participant. Each one stops the clock
   * only for {@link DURABLE_INVOKE_HOLD_MS} of real time per invocation.
   */
  private readonly invokedHolds = new Map<SkipTimeParticipant, InvokedHold>();

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
    if (this.startingDetachedInvoke) {
      // No one waits for the caller, so no one waits for what it invokes.
      this.detached.add(participant);
      this.invokedHolds.set(participant, newHold());
      return;
    }
    this.participants.add(participant);
    if (this.startingInvoke && !this.startingInvoke.invoked) {
      this.startingInvoke.invoked = participant;
      this.invokedHolds.set(participant, newHold());
    }
  }

  /**
   * Removes a finished execution, and lets the others advance without it. The invokes it
   * still waited for no longer hold the clock: no caller remains to resume with their
   * results.
   */
  unregister(participant: SkipTimeParticipant): void {
    this.forgetInvokedHold(participant);
    this.participants.delete(participant);
    this.detached.delete(participant);
    for (const invoke of this.invokes) {
      if (invoke.caller === participant) {
        this.deleteInvoke(invoke);
      }
    }
    this.advance();
  }

  /**
   * Tracks one durable invoke until its caller has queued the invocation that resumes it.
   *
   * `start` must create the invoked function's runner synchronously. The participant that
   * registers during `start` is the invoked function. If none registers, the invoked
   * function runs outside the clock. The clock then does not advance until `end()`, until
   * `caller` unregisters, or until the function has run for
   * {@link NON_DURABLE_INVOKE_HOLD_MS} of real time without returning.
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
      // an invoke the handler did not await. Or no one waits for the caller, because it was
      // detached. No caller remains to resume with the result, and nothing would remove the
      // hold once its caller has unregistered. So the invoked runner registers detached.
      let result: Promise<T>;
      this.startingDetachedInvoke = true;
      try {
        result = start();
      } catch (err) {
        result = Promise.reject(err);
      } finally {
        this.startingDetachedInvoke = false;
      }
      return { result, end: () => undefined };
    }
    const invoke: InvokeHandoff = {
      caller,
      invoked: undefined,
      returned: false,
      holdExpired: false,
      holdTimer: undefined,
    };
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
        `No runner registered while starting an invoke. The fake clock waits up to ${NON_DURABLE_INVOKE_HOLD_MS}ms of real time for it.`,
      );
      const onReturn = () => {
        invoke.returned = true;
      };
      result.then(onReturn, onReturn);
      const timer = realSetTimeout(() => {
        invoke.holdTimer = undefined;
        invoke.holdExpired = true;
        this.advance();
      }, NON_DURABLE_INVOKE_HOLD_MS);
      // A test can finish while the function still runs. The timer must not keep the
      // process alive.
      timer.unref?.();
      invoke.holdTimer = timer;
    }
    return {
      result,
      end: () => {
        // Idempotent: a caller can end a hold after its context has already released it.
        if (this.deleteInvoke(invoke)) {
          this.advance();
        }
      },
    };
  }

  /**
   * Stops tracking an invoke. The invoked function's runner, and every runner it invoked in
   * turn, become detached. See {@link detach}.
   *
   * An invoke stops being tracked in three cases. Its caller resumes with the result. Its
   * caller finishes. Or the context that contains the invoke completes without the result,
   * as when a parallel with `minSuccessful: 1` completes on another branch. In the first
   * case the invoked function has already finished and unregistered. In the other two, no
   * caller waits for the invoked function any more, but it can still be running. A durable
   * invoked function whose step never settles counts as busy forever. So, if it could still
   * stop the clock, the clock would never advance again, for this execution or any later
   * one.
   *
   * @returns whether the invoke was still tracked
   */
  private deleteInvoke(invoke: InvokeHandoff): boolean {
    if (invoke.holdTimer) {
      clearTimeout(invoke.holdTimer);
      invoke.holdTimer = undefined;
    }
    const tracked = this.invokes.delete(invoke);
    if (invoke.invoked) {
      this.detach(invoke.invoked);
    }
    return tracked;
  }

  /**
   * Detaches an abandoned execution and the executions it invoked. Unlike
   * {@link unregister}, this does not advance: the caller of this method advances once it
   * is done.
   *
   * Abandoning an invoke does not cancel the invoked execution, and its live caller can
   * still depend on what it does later, such as a callback it sends. So a detached execution
   * is treated like an invoked one. Its waits and retries still take part in choosing the
   * next end, and it is still told when the clock moves. Each invocation of it stops the
   * clock for at most {@link DURABLE_INVOKE_HOLD_MS} of real time, so short work in it still
   * finishes before a later end, and work that never settles cannot stop the clock for good.
   */
  private detach(participant: SkipTimeParticipant): void {
    if (!this.participants.delete(participant)) {
      return;
    }
    this.detached.add(participant);
    if (!this.invokedHolds.has(participant)) {
      this.invokedHolds.set(participant, newHold());
    }
    for (const invoke of this.invokes) {
      if (invoke.caller === participant) {
        this.deleteInvoke(invoke);
      }
    }
  }

  /**
   * Whether a participant stops the clock now.
   *
   * 1. An idle participant does not.
   * 2. A busy participant that was not invoked always does.
   * 3. An invoked or detached runner with an invocation queued but not yet running does.
   *    That invocation starts as soon as the scheduler reaches it.
   * 4. An invoked or detached runner with an invocation running does, for at most
   *    {@link DURABLE_INVOKE_HOLD_MS} of real time from the first time this sees that
   *    invocation. Each new invocation, identified by
   *    {@link SkipTimeParticipant.runningInvocation}, gets a new hold.
   */
  private holdsClock(participant: SkipTimeParticipant): boolean {
    const hold = this.invokedHolds.get(participant);
    if (!participant.isBusy()) {
      if (hold) {
        this.resetInvokedHold(hold);
      }
      return false;
    }
    if (!hold) {
      return true;
    }
    const invocation = participant.runningInvocation();
    if (invocation === undefined) {
      return true;
    }
    if (hold.invocation !== invocation) {
      this.resetInvokedHold(hold);
      hold.invocation = invocation;
    }
    if (hold.expired) {
      return false;
    }
    if (!hold.timer) {
      const timer = realSetTimeout(() => {
        hold.timer = undefined;
        hold.expired = true;
        defaultLogger.debug(
          `An invocation of an invoked function has run for ${DURABLE_INVOKE_HOLD_MS}ms of real time. The fake clock no longer waits for it.`,
        );
        this.advance();
      }, DURABLE_INVOKE_HOLD_MS);
      // A test can finish while the function still runs. The timer must not keep the
      // process alive.
      timer.unref?.();
      hold.timer = timer;
    }
    return true;
  }

  private resetInvokedHold(hold: InvokedHold): void {
    if (hold.timer) {
      clearTimeout(hold.timer);
      hold.timer = undefined;
    }
    hold.expired = false;
    hold.invocation = undefined;
  }

  private forgetInvokedHold(participant: SkipTimeParticipant): void {
    const hold = this.invokedHolds.get(participant);
    if (hold) {
      this.resetInvokedHold(hold);
      this.invokedHolds.delete(participant);
    }
  }

  /**
   * Advances the clock to the earliest pending end and applies it, if nothing has to run
   * first. Call whenever a participant becomes idle or gains a pending end.
   */
  advance(): void {
    const participants = [...this.participants];
    // Check every participant, not only up to the first that holds the clock: the check
    // also resets the hold of each invoked runner that is idle now. Detached runners hold
    // the clock under the same bounded rule.
    const holding = [...participants, ...this.detached].filter((participant) =>
      this.holdsClock(participant),
    );
    if (holding.length > 0) {
      return;
    }

    for (const invoke of this.invokes) {
      if (invoke.invoked) {
        // An invoked function that is idle without pending work has finished, even if it
        // has not unregistered yet. Its result is on its way back to its caller. One that is
        // still busy here has run past its hold, so it does not stop the clock.
        if (!invoke.invoked.isBusy() && !invoke.invoked.hasPendingWork()) {
          return;
        }
      } else if (invoke.returned || !invoke.holdExpired) {
        // A non-durable function runs outside the clock. Hold for its result while it may
        // still return soon, and always once it has returned.
        return;
      }
    }

    // Detached executions never stop the clock, but their ends still count.
    const timed = [...participants, ...this.detached];
    let earliest: { participant: SkipTimeParticipant; deadlineMs: number } =
      undefined as never;
    for (const participant of timed) {
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

    // No invocation of a participant is running, so none of its SDK timers is pending: a
    // tick only moves Date.now() forward, and fires any timer the test itself has set. An
    // invoked or detached runner past its hold can be running; a tick can fire its timers
    // early.
    const advanceMs = earliest.deadlineMs - Date.now();
    if (advanceMs > 0) {
      defaultLogger.debug(`Advancing fake clock by ${advanceMs}ms`);
      this.clock.tick(advanceMs);
    }
    earliest.participant.applyDeadline(earliest.deadlineMs);

    // Every real timer armed for a later end was computed before the jump, so it would
    // fire too late by the length of the jump. Re-arm them all.
    for (const participant of timed) {
      participant.onClockAdvanced();
    }
  }
}

/** How long an invoked function's runner may still stop the clock. */
interface InvokedHold {
  /** The invocation this hold applies to. See {@link SkipTimeParticipant.runningInvocation}. */
  invocation: number | undefined;
  /** The real timer that sets `expired`, while that invocation runs. */
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Whether that invocation has run past {@link DURABLE_INVOKE_HOLD_MS}. */
  expired: boolean;
}

function newHold(): InvokedHold {
  return { invocation: undefined, timer: undefined, expired: false };
}

/** One durable invoke tracked by {@link SkipTimeCoordinator.startInvoke}. */
interface InvokeHandoff {
  /** The execution waiting for the invoke's result. */
  caller: SkipTimeParticipant;
  /** The invoked function's execution, if it runs on the clock. */
  invoked: SkipTimeParticipant | undefined;
  /** Without `invoked`: whether the function has returned or thrown. */
  returned: boolean;
  /** Without `invoked`: whether the function has run past {@link NON_DURABLE_INVOKE_HOLD_MS}. */
  holdExpired: boolean;
  /** Without `invoked`: the real timer that sets `holdExpired`. */
  holdTimer: ReturnType<typeof setTimeout> | undefined;
}
