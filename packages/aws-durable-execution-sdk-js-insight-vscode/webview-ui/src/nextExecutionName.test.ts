import { nextExecutionName } from "./nextExecutionName";

const GEN = () => "NEW-UUID";

describe("nextExecutionName", () => {
  it("generates a new UUID when the current name is a UUID", () => {
    expect(nextExecutionName("05e62431-cda6-4fed-88f6-e30c3dffc13c", GEN)).toBe(
      "NEW-UUID",
    );
  });

  it("generates a UUID for empty/blank names", () => {
    expect(nextExecutionName("", GEN)).toBe("NEW-UUID");
    expect(nextExecutionName(undefined, GEN)).toBe("NEW-UUID");
    expect(nextExecutionName("   ", GEN)).toBe("NEW-UUID");
  });

  it("increments a trailing number suffix", () => {
    expect(nextExecutionName("order-12345", GEN)).toBe("order-12346");
    expect(nextExecutionName("run5", GEN)).toBe("run6");
    expect(nextExecutionName("demo-run-2", GEN)).toBe("demo-run-3");
  });

  it("preserves zero-padding width", () => {
    expect(nextExecutionName("run007", GEN)).toBe("run008");
    expect(nextExecutionName("abc099", GEN)).toBe("abc100");
  });

  it("appends -1 to anything else", () => {
    expect(nextExecutionName("myexec", GEN)).toBe("myexec-1");
    expect(nextExecutionName("nightly-run", GEN)).toBe("nightly-run-1");
  });
});
