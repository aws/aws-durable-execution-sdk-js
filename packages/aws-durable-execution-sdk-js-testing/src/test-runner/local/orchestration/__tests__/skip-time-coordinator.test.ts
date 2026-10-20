import { Clock, install } from "@sinonjs/fake-timers";
import {
  DURABLE_INVOKE_HOLD_MS,
  NON_DURABLE_INVOKE_HOLD_MS,
  SkipTimeCoordinator,
  SkipTimeParticipant,
} from "../skip-time-coordinator";

function participant(
  overrides: Partial<{
    busy: boolean;
    pendingWork: boolean;
    deadline: number;
    invocation: number;
  }> = {},
): jest.Mocked<SkipTimeParticipant> & { state: typeof overrides } {
  const state = { ...overrides };
  return {
    state,
    isBusy: jest.fn(() => state.busy ?? false),
    // A busy participant runs invocation 1 unless the test says otherwise.
    runningInvocation: jest.fn(() =>
      state.busy ? (state.invocation ?? 1) : undefined,
    ),
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

  /** Starts an invoke whose invoked function is `invoked`, or runs outside the clock. */
  function startInvoke(
    invoked?: SkipTimeParticipant,
    caller?: SkipTimeParticipant,
  ): () => void {
    if (!caller) {
      caller = participant();
      coordinator.register(caller);
    }
    return coordinator.startInvoke(caller, () => {
      if (invoked) {
        coordinator.register(invoked);
      }
      return Promise.resolve();
    }).end;
  }

  it("advances for an invoked function that still has pending work", () => {
    const caller = participant({ deadline: 3000 });
    coordinator.register(caller);
    const invoked = participant({ deadline: 1000 });
    startInvoke(invoked);

    coordinator.advance();

    expect(Date.now()).toBe(1000);
    expect(invoked.applyDeadline).toHaveBeenCalledWith(1000);
  });

  it("does not advance while an invoke's result is on its way back to its caller", () => {
    const caller = participant({ deadline: 3000 });
    coordinator.register(caller);
    const invoked = participant();
    const end = startInvoke(invoked);

    // The invoked function is idle without pending work, so it has finished.
    coordinator.advance();
    coordinator.unregister(invoked);

    expect(Date.now()).toBe(0);

    // The caller has queued the invocation that resumes it.
    end();

    expect(Date.now()).toBe(3000);
    expect(caller.applyDeadline).toHaveBeenCalledWith(3000);
  });

  it("holds a finished invoke's result even while another invoke has pending work", () => {
    const caller = participant({ deadline: 3000 });
    coordinator.register(caller);
    startInvoke(participant());
    startInvoke(participant({ deadline: 3000 }));

    coordinator.advance();

    expect(Date.now()).toBe(0);
  });

  it("does not advance while a function that runs outside the clock is invoked", () => {
    coordinator.register(participant({ deadline: 3000 }));
    const end = startInvoke();

    coordinator.advance();

    expect(Date.now()).toBe(0);

    end();

    expect(Date.now()).toBe(3000);
  });

  it("advances only once when an invoke's hold is ended twice", () => {
    // A context that completes without the invoke's result ends the hold. The invoke's
    // own cleanup ends it again later.
    const owner = participant({ deadline: 1000 });
    coordinator.register(owner);
    const end = startInvoke();
    end();
    expect(owner.applyDeadline).toHaveBeenCalledTimes(1);

    owner.state.deadline = 2000;
    end();

    expect(owner.applyDeadline).toHaveBeenCalledTimes(1);
    expect(Date.now()).toBe(1000);
  });

  it("stops waiting for a function outside the clock after the hold time", async () => {
    // The function never returns, as when a promise combinator stops awaiting it.
    coordinator.register(participant({ deadline: 3000 }));
    const caller = participant();
    coordinator.register(caller);
    coordinator.startInvoke(caller, () => new Promise<void>(() => undefined));

    coordinator.advance();
    expect(Date.now()).toBe(0);

    await new Promise((resolve) =>
      setTimeout(resolve, NON_DURABLE_INVOKE_HOLD_MS + 100),
    );

    expect(Date.now()).toBe(3000);
  });

  it("holds a returned function's result until the caller resumes, even after the hold time", async () => {
    coordinator.register(participant({ deadline: 3000 }));
    const caller = participant();
    coordinator.register(caller);
    let returnResult!: () => void;
    const { end } = coordinator.startInvoke(
      caller,
      () =>
        new Promise<void>((resolve) => {
          returnResult = resolve;
        }),
    );
    await new Promise((resolve) =>
      setTimeout(resolve, NON_DURABLE_INVOKE_HOLD_MS + 100),
    );
    // The hold time has passed, so the clock advanced. Reset it to check the next hold.
    expect(Date.now()).toBe(3000);
    clock.setSystemTime(0);

    returnResult();
    await Promise.resolve();
    coordinator.advance();

    expect(Date.now()).toBe(0);

    end();

    expect(Date.now()).toBe(3000);
  });

  it("stops counting an abandoned durable child and its descendants after the hold time", async () => {
    // The caller abandons the invoke, as when a parallel with minSuccessful 1 completes on
    // another branch. The child, and a grandchild it invoked, still have a step running.
    const caller = participant();
    coordinator.register(caller);
    const child = participant({ busy: true });
    const end = startInvoke(child, caller);
    const grandchild = participant({ busy: true });
    startInvoke(grandchild, child);
    const unrelated = participant({ deadline: 3000 });
    coordinator.register(unrelated);

    coordinator.advance();
    expect(Date.now()).toBe(0);

    end();
    // Detached, the busy child and grandchild hold the clock only for the hold time.
    expect(Date.now()).toBe(0);
    await new Promise((resolve) =>
      setTimeout(resolve, DURABLE_INVOKE_HOLD_MS + 100),
    );

    expect(Date.now()).toBe(3000);
    expect(unrelated.applyDeadline).toHaveBeenCalledWith(3000);
  });

  it("still applies the ends of an abandoned durable child", () => {
    // The abandoned child waits, then a test may depend on what it does next.
    const caller = participant();
    coordinator.register(caller);
    const child = participant({ deadline: 1000 });
    const end = startInvoke(child, caller);
    end();

    coordinator.advance();

    expect(Date.now()).toBe(1000);
    expect(child.applyDeadline).toHaveBeenCalledWith(1000);
    expect(child.onClockAdvanced).toHaveBeenCalled();
  });

  it("waits for a busy invoked runner only for the hold time", async () => {
    // The invoked function runs a step that never settles, and its caller does not wait.
    const caller = participant();
    coordinator.register(caller);
    startInvoke(participant({ busy: true }), caller);
    coordinator.register(participant({ deadline: 3000 }));

    coordinator.advance();
    expect(Date.now()).toBe(0);

    await new Promise((resolve) =>
      setTimeout(resolve, DURABLE_INVOKE_HOLD_MS + 100),
    );

    expect(Date.now()).toBe(3000);
  });

  it("starts a new hold each time an invoked runner becomes busy again", async () => {
    const caller = participant();
    coordinator.register(caller);
    const invoked = participant({ busy: true });
    startInvoke(invoked, caller);
    const other = participant({ deadline: 3000 });
    coordinator.register(other);
    coordinator.advance();
    await new Promise((resolve) =>
      setTimeout(resolve, DURABLE_INVOKE_HOLD_MS + 100),
    );
    expect(Date.now()).toBe(3000);

    // The invocation ends, and the runner is seen idle. Then a new invocation starts.
    invoked.state.busy = false;
    coordinator.advance();
    invoked.state.busy = true;
    other.state.deadline = 6000;
    coordinator.advance();

    expect(Date.now()).toBe(3000);
  });

  it("still holds the clock for a busy runner that was not invoked", async () => {
    coordinator.register(participant({ busy: true }));
    coordinator.register(participant({ deadline: 3000 }));

    coordinator.advance();
    await new Promise((resolve) =>
      setTimeout(resolve, DURABLE_INVOKE_HOLD_MS + 100),
    );

    expect(Date.now()).toBe(0);
  });

  it("forgets a detached child once it unregisters", () => {
    const caller = participant();
    coordinator.register(caller);
    const child = participant();
    startInvoke(child, caller)();
    // The detached child finishes. A deadline it still reports must no longer be chosen.
    coordinator.unregister(child);
    child.state.deadline = 1000;
    child.applyDeadline.mockClear();
    child.onClockAdvanced.mockClear();
    const unrelated = participant({ deadline: 3000 });
    coordinator.register(unrelated);

    coordinator.advance();

    expect(Date.now()).toBe(3000);
    expect(unrelated.applyDeadline).toHaveBeenCalledWith(3000);
    expect(child.applyDeadline).not.toHaveBeenCalled();
    expect(child.onClockAdvanced).not.toHaveBeenCalled();
  });

  it("detaches a runner that an abandoned child invokes later", async () => {
    const caller = participant();
    coordinator.register(caller);
    const child = participant();
    startInvoke(child, caller)();
    // The abandoned child starts an invoke after it was detached.
    const grandchild = participant({ busy: true });
    coordinator.startInvoke(child, () => {
      coordinator.register(grandchild);
      return Promise.resolve();
    });
    coordinator.register(participant({ deadline: 3000 }));

    coordinator.advance();
    expect(Date.now()).toBe(0);
    await new Promise((resolve) =>
      setTimeout(resolve, DURABLE_INVOKE_HOLD_MS + 100),
    );

    // Detached, the busy grandchild holds the clock only for the hold time.
    expect(Date.now()).toBe(3000);
  });

  it("holds the clock for a busy detached runner's new invocation", async () => {
    // An abandoned child's live caller can still wait for a callback the child sends.
    const caller = participant();
    coordinator.register(caller);
    const child = participant({ busy: true, invocation: 1 });
    startInvoke(child, caller)();
    const other = participant({ deadline: 3000 });
    coordinator.register(other);
    await new Promise((resolve) =>
      setTimeout(resolve, DURABLE_INVOKE_HOLD_MS + 100),
    );
    expect(Date.now()).toBe(3000);

    // A wakeup was queued before invocation 1 ended, so the child never looks idle. It
    // then starts invocation 2, which gets a new hold.
    child.state.invocation = 2;
    other.state.deadline = 6000;
    coordinator.advance();

    expect(Date.now()).toBe(3000);
  });

  it("holds the clock while a busy invoked runner's invocation is only queued", async () => {
    const caller = participant();
    coordinator.register(caller);
    const child = participant({ busy: true });
    // Busy, but no invocation running: one is queued.
    child.runningInvocation.mockReturnValue(undefined);
    startInvoke(child, caller);
    coordinator.register(participant({ deadline: 3000 }));

    coordinator.advance();
    await new Promise((resolve) =>
      setTimeout(resolve, DURABLE_INVOKE_HOLD_MS + 100),
    );

    expect(Date.now()).toBe(0);
  });

  it("stops counting a durable child when its caller finishes without the result", async () => {
    const caller = participant();
    coordinator.register(caller);
    startInvoke(participant({ busy: true }), caller);
    const unrelated = participant({ deadline: 3000 });
    coordinator.register(unrelated);

    coordinator.unregister(caller);
    await new Promise((resolve) =>
      setTimeout(resolve, DURABLE_INVOKE_HOLD_MS + 100),
    );

    expect(Date.now()).toBe(3000);
  });

  it("releases an invoke's hold on the clock when its caller finishes", () => {
    // The caller finished without the invoke's result, such as a parallel that completed
    // without that branch. The invoked function never returns.
    const caller = participant();
    coordinator.register(caller);
    startInvoke(undefined, caller);
    const unrelated = participant({ deadline: 3000 });
    coordinator.register(unrelated);

    coordinator.advance();

    expect(Date.now()).toBe(0);

    coordinator.unregister(caller);

    expect(Date.now()).toBe(3000);
    expect(unrelated.applyDeadline).toHaveBeenCalledWith(3000);
  });

  it("does not hold the clock for an invoke whose caller has already finished", () => {
    // The final checkpoint drain can deliver the START of an invoke that the finished
    // handler did not await.
    const finished = participant();
    coordinator.register(finished);
    coordinator.unregister(finished);
    const start = jest.fn(() => Promise.resolve());
    coordinator.startInvoke(finished, start);
    const unrelated = participant({ deadline: 3000 });
    coordinator.register(unrelated);

    coordinator.advance();

    expect(start).toHaveBeenCalledTimes(1);
    expect(Date.now()).toBe(3000);
  });

  it("returns a rejected result when starting the invoke throws", async () => {
    const caller = participant();
    coordinator.register(caller);
    const { result, end } = coordinator.startInvoke(caller, () => {
      throw new Error("no such function");
    });
    end();

    await expect(result).rejects.toThrow("no such function");
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
