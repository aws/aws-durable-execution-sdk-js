import { deterministicSpanId } from "./deterministic-id";

describe("deterministicSpanId", () => {
  it("should return a 16-character hex string", () => {
    const id = deterministicSpanId("step-1");
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("should be deterministic for the same input", () => {
    expect(deterministicSpanId("step-1")).toBe(deterministicSpanId("step-1"));
  });

  it("should produce different IDs for different inputs", () => {
    expect(deterministicSpanId("step-1")).not.toBe(
      deterministicSpanId("step-2"),
    );
  });
});
