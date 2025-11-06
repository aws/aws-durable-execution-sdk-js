import { durationToSeconds } from "./duration";

describe("durationToSeconds", () => {
  it("converts seconds only", () => {
    expect(durationToSeconds({ seconds: 30 })).toBe(30);
  });

  it("converts minutes only", () => {
    expect(durationToSeconds({ minutes: 2 })).toBe(120);
  });

  it("converts hours only", () => {
    expect(durationToSeconds({ hours: 1 })).toBe(3600);
  });

  it("converts days only", () => {
    expect(durationToSeconds({ days: 1 })).toBe(86400);
  });

  it("converts mixed duration", () => {
    expect(
      durationToSeconds({ days: 1, hours: 2, minutes: 30, seconds: 45 }),
    ).toBe(95445);
  });

  it("handles partial duration with days", () => {
    expect(durationToSeconds({ days: 1, minutes: 30 })).toBe(88200);
  });
});
