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
  /** The earliest wait or retry end not yet applied, on the fake clock. */
  earliestDeadline(): number | undefined;
  /**
   * Completes the operations that end by `deadlineMs`, and starts the invocation they
   * release. Called after the fake clock has reached `deadlineMs`.
   */
  applyDeadline(deadlineMs: number): void;
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
 * Advancing past an earlier end would let work resuming at that end start its next delay
 * from the later one.
 */
export class SkipTimeCoordinator {
  private static readonly coordinators = new WeakMap<
    Clock,
    SkipTimeCoordinator
  >();

  private readonly participants = new Set<SkipTimeParticipant>();

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
  }

  /** Removes a finished execution, and lets the others advance without it. */
  unregister(participant: SkipTimeParticipant): void {
    this.participants.delete(participant);
    this.advance();
  }

  /**
   * Advances the clock to the earliest pending end and applies it, if no participant is
   * busy. Call whenever a participant becomes idle or gains a pending end.
   */
  advance(): void {
    let earliest: { participant: SkipTimeParticipant; deadlineMs: number } =
      undefined as never;
    for (const participant of this.participants) {
      if (participant.isBusy()) {
        return;
      }
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
  }
}
