import { relativeTime } from "./relativeTime";

const NOW = 1_700_000_000_000;

describe("relativeTime", () => {
  it("shows the two largest non-zero units, skipping zero ones", () => {
    // 8 hours + 23 seconds ago (0 minutes)
    const t = NOW - (8 * 3600 + 23) * 1000;
    expect(relativeTime(t, NOW)).toBe("8 hours, 23 seconds ago");
  });

  it("singularizes correctly", () => {
    const t = NOW - (1 * 3600 + 1) * 1000;
    expect(relativeTime(t, NOW)).toBe("1 hour, 1 second ago");
  });

  it("handles a single unit", () => {
    expect(relativeTime(NOW - 45 * 1000, NOW)).toBe("45 seconds ago");
  });

  it("handles future instants", () => {
    const t = NOW + (3 * 86400 + 2 * 3600) * 1000;
    expect(relativeTime(t, NOW)).toBe("in 3 days, 2 hours");
  });

  it("returns 'just now' for sub-second diffs", () => {
    expect(relativeTime(NOW - 200, NOW)).toBe("just now");
  });

  it("accepts a Date", () => {
    expect(relativeTime(new Date(NOW - 60 * 1000), NOW)).toBe("1 minute ago");
  });

  it("renders a compact short form", () => {
    const t = NOW - (8 * 3600 + 23) * 1000;
    expect(relativeTime(t, NOW, true)).toBe("8h 23s ago");
    expect(relativeTime(NOW + 2 * 86400 * 1000, NOW, true)).toBe("in 2d");
  });
});
