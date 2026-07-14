import { validateDurableExecutionConfig } from "./config-validation";

describe("validateDurableExecutionConfig", () => {
  it("returns undefined for undefined config", () => {
    expect(validateDurableExecutionConfig(undefined)).toBeUndefined();
  });

  it("returns undefined for an empty config", () => {
    expect(validateDurableExecutionConfig({})).toBeUndefined();
  });

  it("returns undefined for a valid childOperationsDepth", () => {
    expect(
      validateDurableExecutionConfig({
        pluginsConfig: { childOperationsDepth: 2 },
      }),
    ).toBeUndefined();
    expect(
      validateDurableExecutionConfig({
        pluginsConfig: { childOperationsDepth: Infinity },
      }),
    ).toBeUndefined();
  });

  it("surfaces an invalid childOperationsDepth", () => {
    expect(
      validateDurableExecutionConfig({
        pluginsConfig: { childOperationsDepth: -1 },
      }),
    ).toMatch(/childOperationsDepth/);
    expect(
      validateDurableExecutionConfig({
        pluginsConfig: { childOperationsDepth: 1.5 },
      }),
    ).toMatch(/childOperationsDepth/);
  });
});
