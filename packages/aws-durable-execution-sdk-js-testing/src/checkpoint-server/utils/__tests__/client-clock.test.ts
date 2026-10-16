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
});
