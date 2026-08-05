import {
  validateDurableExecutionConfig,
  validateTransportConfig,
} from "./config-validation";

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

  // The transport rule lives in validateTransportConfig, which runs earlier -- see
  // the tests below. This function must not also enforce it, or one of the two calls
  // would be unreachable.
  it("leaves the transport rule to the earlier phase", () => {
    expect(
      validateDurableExecutionConfig({
        client: {} as never,
        durableExecutionClient: {
          getExecutionState: jest.fn(),
          checkpoint: jest.fn(),
        } as never,
      }),
    ).toBeUndefined();
  });
});

describe("validateTransportConfig", () => {
  const stubClient = () =>
    ({ getExecutionState: jest.fn(), checkpoint: jest.fn() }) as never;

  it("rejects supplying both, since they configure the transport incompatibly", () => {
    const error = validateTransportConfig({
      client: {} as never,
      durableExecutionClient: stubClient(),
    });

    expect(error).toContain("Both `client` and `durableExecutionClient`");
    expect(error).toContain("DurableExecutionApiClient");
  });

  it("accepts either one alone", () => {
    expect(validateTransportConfig({ client: {} as never })).toBeUndefined();
    expect(
      validateTransportConfig({ durableExecutionClient: stubClient() }),
    ).toBeUndefined();
  });

  it("accepts neither", () => {
    expect(validateTransportConfig({})).toBeUndefined();
    expect(validateTransportConfig(undefined)).toBeUndefined();
  });
});
