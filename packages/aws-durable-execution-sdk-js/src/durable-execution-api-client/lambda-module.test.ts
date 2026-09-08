/**
 * Covers what happens when `@aws-sdk/client-lambda` cannot be loaded.
 *
 * The loader clears its memo on failure so that a later call retries rather than caching
 * the failure for the lifetime of the process. Each test re-imports the module so it starts
 * with a fresh memo.
 */
describe("loadLambdaModule failure handling", () => {
  const fakeModule = {
    LambdaClient: class {
      send = jest.fn();
    },
    CheckpointDurableExecutionCommand: class {},
    GetDurableExecutionStateCommand: class {},
  };

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.dontMock("@aws-sdk/client-lambda");
    jest.resetModules();
  });

  it("propagates the load failure to the caller", async () => {
    jest.doMock("@aws-sdk/client-lambda", () => {
      throw new Error("module missing");
    });

    const { loadLambdaModule } = await import("./lambda-module");

    await expect(loadLambdaModule()).rejects.toThrow("module missing");
  });

  it("does not cache the failure, so a later call retries", async () => {
    let attempts = 0;
    jest.doMock("@aws-sdk/client-lambda", () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("transient failure");
      }
      return fakeModule;
    });

    const { loadLambdaModule } = await import("./lambda-module");

    await expect(loadLambdaModule()).rejects.toThrow("transient failure");

    // The memo was cleared, so this call loads again rather than replaying the rejection.
    const module = await loadLambdaModule();
    expect(typeof module.LambdaClient).toBe("function");
    expect(attempts).toBe(2);
  });

  it("does not report an unhandled rejection when construction prefetches a failing load", async () => {
    jest.doMock("@aws-sdk/client-lambda", () => {
      throw new Error("module missing");
    });

    const unhandled = jest.fn();
    process.on("unhandledRejection", unhandled);

    try {
      const { DurableExecutionApiClient } = await import(
        "./durable-execution-api-client"
      );

      // The constructor starts the load without awaiting it. Its rejection must be
      // absorbed rather than surfacing as an unhandled rejection.
      new DurableExecutionApiClient();

      // Give the microtask queue a chance to settle the prefetch.
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("accepts a namespace whose exports sit under `default`", async () => {
    // Depending on how the consuming bundle resolves the dependency, a dynamic import can
    // yield an ES module namespace whose only export is `default`. The `__esModule` marker
    // is what makes TypeScript's interop helper pass the namespace through untouched, which
    // is the situation this fallback handles.
    jest.doMock("@aws-sdk/client-lambda", () => ({
      __esModule: true,
      default: fakeModule,
    }));

    const { loadLambdaModule } = await import("./lambda-module");

    const module = await loadLambdaModule();
    expect(module.LambdaClient).toBe(fakeModule.LambdaClient);
  });

  it("surfaces the load failure from a request rather than swallowing it", async () => {
    jest.doMock("@aws-sdk/client-lambda", () => {
      throw new Error("module missing");
    });

    const { DurableExecutionApiClient } = await import(
      "./durable-execution-api-client"
    );

    const apiClient = new DurableExecutionApiClient();

    await expect(
      apiClient.checkpoint({
        DurableExecutionArn: "test-arn",
        CheckpointToken: "test-token",
        Updates: [],
      }),
    ).rejects.toThrow("module missing");
  });
});
