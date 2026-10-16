import {
  currentTime,
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
    observeClientTime(Date.parse("2030-01-01T01:00:00.020Z"));
    expect(currentTime()).toEqual(new Date("2030-01-01T01:00:00.020Z"));

    // The next request reports a clock 15 ms behind the time already reported.
    observeClientTime(Date.parse("2030-01-01T01:00:00.005Z"));

    expect(currentTime()).toEqual(new Date("2030-01-01T01:00:00.020Z"));
  });

  it("follows a clock that was reset to an earlier time", () => {
    observeClientTime(Date.parse("2030-01-01T05:00:00.000Z"));
    currentTime();

    // A new test environment installs a new fake clock at real time.
    observeClientTime(Date.parse("2030-01-01T00:00:00.000Z"));

    expect(currentTime()).toEqual(new Date("2030-01-01T00:00:00.000Z"));
  });
});
