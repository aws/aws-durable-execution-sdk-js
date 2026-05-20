import { createLinearRetryStrategy } from "./linear-retry-strategy";

describe("createLinearRetryStrategy", () => {
  it("should create linear backoff delays", () => {
    const strategy = createLinearRetryStrategy(5, 2, 3);

    expect(strategy(new Error("test"), 1)).toEqual({
      shouldRetry: true,
      delay: { seconds: 2 }, // 2 + (3 * 0)
    });

    expect(strategy(new Error("test"), 2)).toEqual({
      shouldRetry: true,
      delay: { seconds: 5 }, // 2 + (3 * 1)
    });

    expect(strategy(new Error("test"), 3)).toEqual({
      shouldRetry: true,
      delay: { seconds: 8 }, // 2 + (3 * 2)
    });
  });

  it("should stop retrying after max attempts", () => {
    const strategy = createLinearRetryStrategy(3);

    expect(strategy(new Error("test"), 3)).toEqual({
      shouldRetry: false,
    });
  });

  it("should use default values", () => {
    const strategy = createLinearRetryStrategy();

    expect(strategy(new Error("test"), 1)).toEqual({
      shouldRetry: true,
      delay: { seconds: 1 },
    });

    expect(strategy(new Error("test"), 2)).toEqual({
      shouldRetry: true,
      delay: { seconds: 2 },
    });
  });
});
