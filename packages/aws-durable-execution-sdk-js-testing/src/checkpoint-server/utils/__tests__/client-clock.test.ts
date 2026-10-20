import {
  currentTime,
  ExecutionClock,
  observeClientTime,
  resetClientTimeForTesting,
} from "../client-clock";

describe("client clock", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    resetClientTimeForTesting();
  });

  afterEach(() => {
    resetClientTimeForTesting();
    jest.useRealTimers();
  });

  it("reads the local clock before any request is observed", () => {
    expect(currentTime()).toEqual(new Date("2030-01-01T00:00:00.000Z"));
  });

  it("reads the client's clock, advancing with local time", () => {
    // The client's clock is one hour ahead, as after a skipped one-hour wait.
    observeClientTime(Date.parse("2030-01-01T01:00:00.000Z"));
    expect(currentTime()).toEqual(new Date("2030-01-01T01:00:00.000Z"));

    jest.advanceTimersByTime(1500);
    expect(currentTime()).toEqual(new Date("2030-01-01T01:00:01.500Z"));
  });

  it("keeps the last offset when a request carries no client time", () => {
    observeClientTime(Date.parse("2030-01-01T01:00:00.000Z"));
    observeClientTime(undefined);

    expect(currentTime()).toEqual(new Date("2030-01-01T01:00:00.000Z"));
  });

  it("does not go back by one fake-clock step between requests", () => {
    const clock = new ExecutionClock();
    observeClientTime(Date.parse("2030-01-01T01:00:00.020Z"));
    expect(clock.now()).toEqual(new Date("2030-01-01T01:00:00.020Z"));

    // The next request reports a clock 15 ms behind the time already reported.
    observeClientTime(Date.parse("2030-01-01T01:00:00.005Z"));

    expect(clock.now()).toEqual(new Date("2030-01-01T01:00:00.020Z"));
  });

  it("does not go back after the main thread stalls while the server records a time", () => {
    const clock = new ExecutionClock();
    observeClientTime(Date.parse("2030-01-01T01:00:00.000Z"));

    // The main thread is blocked, so its fake clock stops. The server keeps running and
    // records a time, for example a callback timeout.
    jest.advanceTimersByTime(2000);
    expect(clock.now()).toEqual(new Date("2030-01-01T01:00:02.000Z"));

    // After the stall, the main thread's clock is 1.9 s behind that time.
    observeClientTime(Date.parse("2030-01-01T01:00:00.100Z"));
    expect(clock.now()).toEqual(new Date("2030-01-01T01:00:02.000Z"));

    // The time holds until the main thread's clock passes it, then follows that clock.
    jest.advanceTimersByTime(2000);
    expect(clock.now()).toEqual(new Date("2030-01-01T01:00:02.100Z"));
  });

  it("keeps each execution's clock separate", () => {
    const stalled = new ExecutionClock();
    observeClientTime(Date.parse("2030-01-01T01:00:00.000Z"));
    jest.advanceTimersByTime(2000);
    stalled.now();
    observeClientTime(Date.parse("2030-01-01T01:00:00.100Z"));

    // A later execution reads the main thread's clock, not the stalled one's hold.
    expect(new ExecutionClock().now()).toEqual(
      new Date("2030-01-01T01:00:00.100Z"),
    );
  });
});
