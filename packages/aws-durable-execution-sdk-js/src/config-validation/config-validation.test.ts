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

  describe("client and durableExecutionClient", () => {
    const stubClient = () =>
      ({ getExecutionState: jest.fn(), checkpoint: jest.fn() }) as never;

    it("rejects supplying both, since they configure the transport incompatibly", () => {
      const error = validateDurableExecutionConfig({
        client: {} as never,
        durableExecutionClient: stubClient(),
      });

      expect(error).toContain("Both `client` and `durableExecutionClient`");
      expect(error).toContain("DurableExecutionApiClient");
    });

    it("accepts either one alone", () => {
      expect(
        validateDurableExecutionConfig({ client: {} as never }),
      ).toBeUndefined();
      expect(
        validateDurableExecutionConfig({
          durableExecutionClient: stubClient(),
        }),
      ).toBeUndefined();
    });

    it("accepts neither", () => {
      expect(validateDurableExecutionConfig({})).toBeUndefined();
    });
  });
});
