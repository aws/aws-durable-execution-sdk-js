import { waitOptionsToSeconds, durationToSeconds } from "./duration";
import { WaitOptions, Duration } from "../../types/core";

describe("waitOptionsToSeconds", () => {
  beforeEach(() => {
    // Mock Date.now() to return April 7th, 1999 baseline
    jest.spyOn(Date, "now").mockReturnValue(923443200000); // April 7, 1999
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("endTimestamp handling", () => {
    it("should calculate correct seconds for future timestamp", () => {
      const futureTime = new Date(923443205000).toISOString(); // 5 seconds in the future
      const waitOptions: WaitOptions = { endTimestamp: futureTime };

      expect(waitOptionsToSeconds(waitOptions)).toBe(5);
    });

    it("should return 0 for past timestamp", () => {
      const pastTime = new Date(923443195000).toISOString(); // 5 seconds in the past
      const waitOptions: WaitOptions = { endTimestamp: pastTime };

      expect(waitOptionsToSeconds(waitOptions)).toBe(0);
    });

    it("should return 0 for current timestamp", () => {
      const currentTime = new Date(923443200000).toISOString(); // exactly now
      const waitOptions: WaitOptions = { endTimestamp: currentTime };

      expect(waitOptionsToSeconds(waitOptions)).toBe(0);
    });

    it("should round millisecond precision up", () => {
      const futureTime = new Date(923443201500).toISOString(); // 1.5 seconds in the future
      const waitOptions: WaitOptions = { endTimestamp: futureTime };

      // Should round up to 2 seconds
      expect(waitOptionsToSeconds(waitOptions)).toBe(2);
    });

    it("should handle different ISO timestamp formats", () => {
      // Test with timezone
      const futureTime = "1999-04-07T00:00:05-00:00"; // 5 seconds in the future
      const waitOptions: WaitOptions = { endTimestamp: futureTime };

      expect(waitOptionsToSeconds(waitOptions)).toBe(5);
    });
  });

  describe("duration handling", () => {
    it("should delegate to durationToSeconds for duration objects", () => {
      const duration: Duration = { seconds: 30 };
      const waitOptions: WaitOptions = duration;

      expect(waitOptionsToSeconds(waitOptions)).toBe(30);
    });

    it("should handle complex duration objects", () => {
      const duration: Duration = { hours: 1, minutes: 30, seconds: 45 };
      const waitOptions: WaitOptions = duration;

      expect(waitOptionsToSeconds(waitOptions)).toBe(5445); // 1*3600 + 30*60 + 45
    });
  });
});

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
