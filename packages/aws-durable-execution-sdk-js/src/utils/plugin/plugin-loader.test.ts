import { PluginLoadError } from "../../errors/plugin-load-error/plugin-load-error";
import {
  DurableInstrumentationPlugin,
  DurableInstrumentationPluginFactory,
  InvocationInfo,
} from "../../types/plugin";
import {
  createDefaultModuleImporter,
  loadConfiguredPlugins,
  PLUGIN_ENVIRONMENT_VARIABLE,
  PLUGIN_PROVIDER_EXPORT,
} from "./plugin-loader";
import { pathToFileURL } from "url";

class ExplicitPlugin implements DurableInstrumentationPlugin {}
class FirstDynamicPlugin implements DurableInstrumentationPlugin {}
class SecondDynamicPlugin implements DurableInstrumentationPlugin {}

const invocationInfo: InvocationInfo = {
  requestId: "req-1",
  executionArn: "arn:test",
  isFirstInvocation: true,
  executionInput: {},
  operations: {},
  updatedOperations: {},
};

/** A provider export: the factory the SDK calls once per invocation. */
function factoryFor<Plugin extends DurableInstrumentationPlugin>(
  createPlugin: () => Plugin,
): DurableInstrumentationPluginFactory<Plugin> {
  return () => createPlugin();
}

function moduleFor(provider: unknown): Record<string, unknown> {
  return { [PLUGIN_PROVIDER_EXPORT]: provider };
}

function moduleNotFoundError(
  missingModule: string,
  code: "ERR_MODULE_NOT_FOUND" | "MODULE_NOT_FOUND" = "ERR_MODULE_NOT_FOUND",
): Error & { code: string } {
  return Object.assign(
    new Error(`Cannot find package '${missingModule}' imported from test.mjs`),
    { code },
  );
}

describe("createDefaultModuleImporter", () => {
  it("does not fall back when a resolved provider fails during evaluation", async () => {
    const evaluationError = new Error("provider evaluation failed");
    const importModule = jest.fn(async (): Promise<unknown> => {
      throw evaluationError;
    });
    const resolveModule = jest.fn();
    const importer = createDefaultModuleImporter(
      {},
      { importModule, resolveModule },
    );

    await expect(importer("@example/plugin")).rejects.toBe(evaluationError);
    expect(resolveModule).not.toHaveBeenCalled();
  });

  it("does not fall back when a provider dependency is missing", async () => {
    const dependencyError = moduleNotFoundError("@example/missing-peer");
    const importModule = jest.fn(async (): Promise<unknown> => {
      throw dependencyError;
    });
    const resolveModule = jest.fn();
    const importer = createDefaultModuleImporter(
      {},
      { importModule, resolveModule },
    );

    await expect(importer("@example/plugin")).rejects.toBe(dependencyError);
    expect(resolveModule).not.toHaveBeenCalled();
  });

  it("loads a configured provider from the application resolution path", async () => {
    const nativeImportError = moduleNotFoundError("@example/plugin");
    const importedModule = { provider: true };
    const resolvedPath = "/opt/nodejs/node_modules/@example/plugin/index.mjs";
    const importModule = jest
      .fn<Promise<unknown>, [string]>()
      .mockRejectedValueOnce(nativeImportError)
      .mockResolvedValueOnce(importedModule);
    const resolveModule = jest.fn(() => resolvedPath);
    const importer = createDefaultModuleImporter(
      {},
      { importModule, resolveModule },
    );

    await expect(importer("@example/plugin")).resolves.toBe(importedModule);
    expect(resolveModule).toHaveBeenCalledWith("@example/plugin");
    expect(importModule.mock.calls).toEqual([
      ["@example/plugin"],
      [pathToFileURL(resolvedPath).href],
    ]);
  });

  it("preserves both resolution errors when the provider is unavailable", async () => {
    const nativeImportError = moduleNotFoundError("@example/missing");
    const applicationResolveError = moduleNotFoundError(
      "@example/missing",
      "MODULE_NOT_FOUND",
    );
    const importer = createDefaultModuleImporter(
      {},
      {
        importModule: async () => {
          throw nativeImportError;
        },
        resolveModule: () => {
          throw applicationResolveError;
        },
      },
    );

    try {
      await importer("@example/missing");
      throw new Error("Expected the importer to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect(error).toMatchObject({
        name: "PluginModuleResolutionError",
        message: expect.stringContaining(
          "Unable to resolve '@example/missing'",
        ),
        errors: [nativeImportError, applicationResolveError],
      });
    }
  });
});

describe("loadConfiguredPlugins", () => {
  it("preserves explicit factories without importing modules when configuration is unset", async () => {
    const explicitFactory = factoryFor(() => new ExplicitPlugin());
    const importModule = jest.fn();

    const result = await loadConfiguredPlugins([explicitFactory], {
      environment: {},
      importModule,
    });

    expect(result).toEqual([explicitFactory]);
    expect(importModule).not.toHaveBeenCalled();
  });

  it("treats a blank environment variable as disabled", async () => {
    const explicitFactory = factoryFor(() => new ExplicitPlugin());
    const importModule = jest.fn();

    const result = await loadConfiguredPlugins([explicitFactory], {
      environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "  " },
      importModule,
    });

    expect(result).toEqual([explicitFactory]);
    expect(importModule).not.toHaveBeenCalled();
  });

  it("loads configured providers in order after explicit factories", async () => {
    const explicitFactory = factoryFor(() => new ExplicitPlugin());
    const firstFactory = factoryFor(() => new FirstDynamicPlugin());
    const secondFactory = factoryFor(() => new SecondDynamicPlugin());
    const modules: Record<string, unknown> = {
      "@example/first": moduleFor(firstFactory),
      "@example/second/provider": moduleFor(secondFactory),
    };
    const importModule = jest.fn(
      async (specifier: string): Promise<unknown> => modules[specifier],
    );

    const result = await loadConfiguredPlugins([explicitFactory], {
      environment: {
        [PLUGIN_ENVIRONMENT_VARIABLE]:
          " @example/first, @example/second/provider ",
      },
      importModule,
    });

    expect(importModule.mock.calls).toEqual([
      ["@example/first"],
      ["@example/second/provider"],
    ]);
    expect(result).toEqual([explicitFactory, firstFactory, secondFactory]);
  });

  it("keeps explicit and dynamic factories for the same plugin type additive", async () => {
    const explicitFactory = factoryFor(() => new FirstDynamicPlugin());
    const dynamicFactory = factoryFor(() => new FirstDynamicPlugin());

    const result = await loadConfiguredPlugins([explicitFactory], {
      environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/first" },
      importModule: async () => moduleFor(dynamicFactory),
    });

    expect(result).toEqual([explicitFactory, dynamicFactory]);
  });

  it.each(["first,", ",first", "first,,second"])(
    "rejects empty module specifiers in %s",
    async (configuredPlugins) => {
      await expect(
        loadConfiguredPlugins([], {
          environment: {
            [PLUGIN_ENVIRONMENT_VARIABLE]: configuredPlugins,
          },
          importModule: jest.fn(),
        }),
      ).rejects.toThrow(
        `${PLUGIN_ENVIRONMENT_VARIABLE} must contain non-empty, comma-separated package or module specifiers.`,
      );
    },
  );

  it("rejects duplicate configured module specifiers", async () => {
    await expect(
      loadConfiguredPlugins([], {
        environment: {
          [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin, @example/plugin",
        },
        importModule: jest.fn(),
      }),
    ).rejects.toThrow(
      `${PLUGIN_ENVIRONMENT_VARIABLE} contains duplicate module specifier '@example/plugin'.`,
    );
  });

  it("wraps module evaluation failures without masking their cause", async () => {
    const importError = new Error("module not found");

    const result = loadConfiguredPlugins([], {
      environment: {
        [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin",
      },
      importModule: async () => {
        throw importError;
      },
    });

    await expect(result).rejects.toMatchObject({
      name: "PluginLoadError",
      message: expect.stringContaining("module not found"),
      cause: importError,
    });
    await expect(result).rejects.not.toThrow(
      "Ensure the package is installed in the function artifact",
    );
  });

  it("adds layer packaging guidance when the provider cannot be resolved", async () => {
    const nativeImportError = moduleNotFoundError("@example/missing");
    const applicationResolveError = moduleNotFoundError(
      "@example/missing",
      "MODULE_NOT_FOUND",
    );

    await expect(
      loadConfiguredPlugins([], {
        environment: {
          [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/missing",
        },
        moduleImporterDependencies: {
          importModule: async () => {
            throw nativeImportError;
          },
          resolveModule: () => {
            throw applicationResolveError;
          },
        },
      }),
    ).rejects.toMatchObject({
      name: "PluginLoadError",
      message: expect.stringContaining(
        "Ensure the package is installed in the function artifact or an attached Lambda layer",
      ),
      cause: expect.objectContaining({
        name: "PluginModuleResolutionError",
        errors: [nativeImportError, applicationResolveError],
      }),
    });
  });

  it("rejects a non-object module namespace", async () => {
    await expect(
      loadConfiguredPlugins([], {
        environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
        importModule: async () => "not a module",
      }),
    ).rejects.toThrow(
      "Plugin module '@example/plugin' did not evaluate to a module namespace object.",
    );
  });

  it("rejects a module without the provider export", async () => {
    await expect(
      loadConfiguredPlugins([], {
        environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
        importModule: async () => ({ default: {} }),
      }),
    ).rejects.toThrow(
      `Plugin module '@example/plugin' must export '${PLUGIN_PROVIDER_EXPORT}'.`,
    );
  });

  it("loads the provider from a CommonJS default namespace", async () => {
    const factory = factoryFor(() => new FirstDynamicPlugin());

    const result = await loadConfiguredPlugins([], {
      environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
      importModule: async () => ({
        default: { [PLUGIN_PROVIDER_EXPORT]: factory },
      }),
    });

    expect(result).toEqual([factory]);
  });

  it("accepts duplicate ESM and CommonJS views of the same provider export", async () => {
    const factory = factoryFor(() => new FirstDynamicPlugin());

    const result = await loadConfiguredPlugins([], {
      environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
      importModule: async () => ({
        [PLUGIN_PROVIDER_EXPORT]: factory,
        default: { [PLUGIN_PROVIDER_EXPORT]: factory },
      }),
    });

    expect(result).toEqual([factory]);
  });

  it("rejects conflicting ESM and CommonJS provider exports", async () => {
    await expect(
      loadConfiguredPlugins([], {
        environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
        importModule: async () => ({
          [PLUGIN_PROVIDER_EXPORT]: factoryFor(() => new FirstDynamicPlugin()),
          default: {
            [PLUGIN_PROVIDER_EXPORT]: factoryFor(
              () => new SecondDynamicPlugin(),
            ),
          },
        }),
      }),
    ).rejects.toThrow(
      `Plugin module '@example/plugin' exposes multiple different '${PLUGIN_PROVIDER_EXPORT}' values.`,
    );
  });

  it.each([
    { desc: "an object", provider: { createPlugin: () => ({}) } },
    { desc: "a string", provider: "not a provider" },
    { desc: "null", provider: null },
  ])("rejects a provider export that is $desc", async ({ provider }) => {
    await expect(
      loadConfiguredPlugins([], {
        environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
        importModule: async () => moduleFor(provider),
      }),
    ).rejects.toThrow(
      "Plugin provider '@example/plugin' must be a function that creates a plugin for one invocation",
    );
  });

  it("names what the provider export was instead of a function", async () => {
    await expect(
      loadConfiguredPlugins([], {
        environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
        importModule: async () => moduleFor({}),
      }),
    ).rejects.toMatchObject({
      name: "PluginLoadError",
      message: expect.stringContaining("but it is an object."),
    });
  });

  it("uses PluginLoadError for configuration failures", async () => {
    await expect(
      loadConfiguredPlugins([], {
        environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "," },
      }),
    ).rejects.toBeInstanceOf(PluginLoadError);
  });
});

describe("loadConfiguredPlugins returns factories, not plugins", () => {
  const loadProvider = async (
    provider: unknown,
  ): Promise<DurableInstrumentationPluginFactory[]> =>
    loadConfiguredPlugins([], {
      environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
      importModule: async () => moduleFor(provider),
    });

  it("does not construct a plugin while loading a provider", async () => {
    const factory = jest.fn(() => new FirstDynamicPlugin());

    const [loaded] = await loadProvider(factory);

    expect(factory).not.toHaveBeenCalled();
    expect(loaded).toBe(factory);
  });

  it("returns the provider export itself, so each call yields a new instance", async () => {
    const created: FirstDynamicPlugin[] = [];
    const [factory] = await loadProvider(() => {
      const plugin = new FirstDynamicPlugin();
      created.push(plugin);
      return plugin;
    });

    factory(invocationInfo);
    factory(invocationInfo);

    expect(created).toHaveLength(2);
    expect(created[0]).not.toBe(created[1]);
  });

  it("passes the invocation info straight through to the provider factory", async () => {
    const factory = jest.fn(() => new FirstDynamicPlugin());
    const [loaded] = await loadProvider(factory);

    loaded(invocationInfo);

    expect(factory).toHaveBeenCalledWith(invocationInfo);
  });

  it("lets a failing factory throw when it runs instead of at load time", async () => {
    const constructionError = new Error("missing configuration");

    const [factory] = await loadProvider((): FirstDynamicPlugin => {
      throw constructionError;
    });

    expect(() => factory(invocationInfo)).toThrow(constructionError);
  });
});
