import { Clock, install } from "@sinonjs/fake-timers";
import {
  SkipTimeCoordinator,
  SkipTimeParticipant,
} from "../skip-time-coordinator";

function participant(
  overrides: Partial<{
    busy: boolean;
    invokeInFlight: boolean;
    pendingWork: boolean;
    deadline: number;
  }> = {},
): jest.Mocked<SkipTimeParticipant> & { state: typeof overrides } {
  const state = { ...overrides };
  return {
    state,
    isBusy: jest.fn(() => state.busy ?? false),
    hasInvokeInFlight: jest.fn(() => state.invokeInFlight ?? false),
    hasPendingWork: jest.fn(
      () => state.pendingWork ?? state.deadline !== undefined,
    ),
    earliestDeadline: jest.fn(() => state.deadline),
    applyDeadline: jest.fn(),
    onClockAdvanced: jest.fn(),
  };
}

describe("SkipTimeCoordinator", () => {
  let clock: Clock & { uninstall(): void };
  let coordinator: SkipTimeCoordinator;

  beforeEach(() => {
    clock = install({ now: 0, toFake: ["Date"] }) as Clock & {
      uninstall(): void;
    };
    coordinator = SkipTimeCoordinator.forClock(clock);
  });

  afterEach(() => {
    clock.uninstall();
  });

  it("returns one coordinator per clock", () => {
    expect(SkipTimeCoordinator.forClock(clock)).toBe(coordinator);
  });

  it("advances to the earliest end across participants and applies it there", () => {
    const later = participant({ deadline: 3000 });
    const earlier = participant({ deadline: 1000 });
    coordinator.register(later);
    coordinator.register(earlier);

    coordinator.advance();

    expect(Date.now()).toBe(1000);
    expect(earlier.applyDeadline).toHaveBeenCalledWith(1000);
    expect(later.applyDeadline).not.toHaveBeenCalled();
  });

  it("re-times every participant after the clock moves", () => {
    const later = participant({ deadline: 3000 });
    const earlier = participant({ deadline: 1000 });
    coordinator.register(later);
    coordinator.register(earlier);

    coordinator.advance();

    expect(later.onClockAdvanced).toHaveBeenCalledTimes(1);
    expect(earlier.onClockAdvanced).toHaveBeenCalledTimes(1);
  });

  it("does not advance while any participant is busy", () => {
    coordinator.register(participant({ deadline: 1000 }));
    coordinator.register(participant({ busy: true }));

    coordinator.advance();

    expect(Date.now()).toBe(0);
  });

  it("does not advance while an invoke's result is on its way back to its caller", () => {
    // The invoked function has finished and unregistered. Only the caller remains.
    const caller = participant({ invokeInFlight: true, deadline: 3000 });
    coordinator.register(caller);

    coordinator.advance();

    expect(Date.now()).toBe(0);
    expect(caller.applyDeadline).not.toHaveBeenCalled();
  });

  it("advances for an invoked function that still has pending work", () => {
    const caller = participant({ invokeInFlight: true, deadline: 3000 });
    const invoked = participant({ deadline: 1000 });
    coordinator.register(caller);
    coordinator.register(invoked);

    coordinator.advance();

    expect(Date.now()).toBe(1000);
    expect(invoked.applyDeadline).toHaveBeenCalledWith(1000);
  });

  it("advances once a finished execution unregisters", () => {
    const busy = participant({ busy: true });
    const waiting = participant({ deadline: 1000 });
    coordinator.register(busy);
    coordinator.register(waiting);

    coordinator.unregister(busy);

    expect(Date.now()).toBe(1000);
    expect(waiting.applyDeadline).toHaveBeenCalledWith(1000);
  });
});
