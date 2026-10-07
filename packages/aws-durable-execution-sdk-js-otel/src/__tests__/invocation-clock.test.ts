import { invocationStartUpperBound } from "../invocation-clock";

describe("invocation start upper bound", () => {
  const seconds = 1_700_000_000;
  it.each([
    {
      name: "exact integer",
      after: 1_000_000,
      window: 0,
      carry: 0,
      upper: 1_000_000,
    },
    {
      name: "fractional millisecond",
      after: 1_250_000,
      window: 0,
      carry: 0,
      upper: 2_000_000,
    },
    {
      name: "nonzero window at an integer",
      after: 1_000_000,
      window: 1,
      carry: 0,
      upper: 2_000_000,
    },
    {
      name: "fraction plus uncertainty reaches an integer",
      after: 1_250_000,
      window: 1.5,
      carry: 0,
      upper: 2_000_000,
    },
    {
      name: "fraction plus uncertainty passes an integer",
      after: 1_750_000,
      window: 1,
      carry: 0,
      upper: 3_000_000,
    },
    {
      name: "small uncertainty is not lost in the epoch",
      after: 1_000_000,
      window: 0.0002,
      carry: 0,
      upper: 2_000_000,
    },
    {
      name: "exact second rollover",
      after: 999_750_000,
      window: 0.5,
      carry: 1,
      upper: 0,
    },
    {
      name: "fractional second rollover",
      after: 999_750_000,
      window: 1,
      carry: 1,
      upper: 1_000_000,
    },
    {
      name: "nanosecond edge reaches next second",
      after: 999_999_999,
      window: 0.000002,
      carry: 1,
      upper: 0,
    },
  ])("$name", ({ after, window, carry, upper }) => {
    expect(
      invocationStartUpperBound(
        {
          epochMillis: seconds * 1000,
          monotonicMillis: 100,
          sampleWindowMillis: window,
        },
        [seconds, after],
      ),
    ).toEqual([seconds + carry, upper]);
  });
});
