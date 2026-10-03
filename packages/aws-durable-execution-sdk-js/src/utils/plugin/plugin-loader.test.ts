import { PluginLoadError } from "../../errors/plugin-load-error/plugin-load-error";
import {
  DurableInstrumentationPlugin,
  DurableInstrumentationPluginFactory,
  DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION,
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
  return { createPlugin: () => createPlugin() };
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
    { desc: "a plugin instance", provider: new FirstDynamicPlugin() },
    { desc: "an object without the method", provider: { create: () => ({}) } },
    { desc: "a string", provider: "not a provider" },
    { desc: "null", provider: null },
  ])("rejects a provider export that is $desc", async ({ provider }) => {
    await expect(
      loadConfiguredPlugins([], {
        environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
        importModule: async () => moduleFor(provider),
      }),
    ).rejects.toThrow(
      "Plugin provider '@example/plugin' must be an object with a 'createPlugin(info)' method that creates a plugin for one invocation",
    );
  });

  it("rejects a provider export whose createPlugin is not callable", async () => {
    await expect(
      loadConfiguredPlugins([], {
        environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
        importModule: async () => moduleFor({ createPlugin: "nope" }),
      }),
    ).rejects.toThrow(
      "Plugin provider '@example/plugin' must be an object with a 'createPlugin(info)' method",
    );
  });

  it("names what the provider export was instead of a factory", async () => {
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
    const createPlugin = jest.fn(() => new FirstDynamicPlugin());
    const factory = { createPlugin };

    const [loaded] = await loadProvider(factory);

    expect(createPlugin).not.toHaveBeenCalled();
    expect(loaded).toBe(factory);
  });

  it("returns the provider export itself, so each call yields a new instance", async () => {
    const created: FirstDynamicPlugin[] = [];
    const [factory] = await loadProvider({
      createPlugin: () => {
        const plugin = new FirstDynamicPlugin();
        created.push(plugin);
        return plugin;
      },
    });

    factory.createPlugin(invocationInfo);
    factory.createPlugin(invocationInfo);

    expect(created).toHaveLength(2);
    expect(created[0]).not.toBe(created[1]);
  });

  it("passes the invocation info straight through to createPlugin", async () => {
    const createPlugin = jest.fn(() => new FirstDynamicPlugin());
    const [loaded] = await loadProvider({ createPlugin });

    loaded.createPlugin(invocationInfo);

    expect(createPlugin).toHaveBeenCalledWith(invocationInfo);
  });

  it("lets a failing createPlugin throw when it runs instead of at load time", async () => {
    const constructionError = new Error("missing configuration");

    const [factory] = await loadProvider({
      createPlugin: (): FirstDynamicPlugin => {
        throw constructionError;
      },
    });

    expect(() => factory.createPlugin(invocationInfo)).toThrow(
      constructionError,
    );
  });
});

describe("loadConfiguredPlugins validates explicit entries", () => {
  // Same rule as the provider path: an entry the SDK could never get an instance
  // from is a configuration mistake, reported once at load time rather than
  // swallowed on every invocation.
  const loadExplicit = async (
    ...entries: unknown[]
  ): Promise<DurableInstrumentationPluginFactory[]> =>
    loadConfiguredPlugins(entries as DurableInstrumentationPluginFactory[], {
      environment: {},
    });

  it.each([
    {
      desc: "a plugin instance",
      entry: new ExplicitPlugin(),
      named: "an object",
    },
    { desc: "a string", entry: "not a factory", named: "a string" },
    { desc: "null", entry: null, named: "null" },
    { desc: "undefined", entry: undefined, named: "undefined" },
  ])("rejects an explicit entry that is $desc", async ({ entry, named }) => {
    await expect(loadExplicit(entry)).rejects.toMatchObject({
      name: "PluginLoadError",
      message: expect.stringContaining(
        "Plugin at plugins[0] must be an object with a 'createPlugin(info)' " +
          "method that creates a plugin for one invocation, but it is " +
          `${named}. ` +
          "Pass a factory such as `{ createPlugin: (info) => new MyPlugin() }`.",
      ),
    });
  });

  it("names the position of the offending entry", async () => {
    const factory = factoryFor(() => new ExplicitPlugin());

    await expect(
      loadExplicit(factory, factory, new ExplicitPlugin()),
    ).rejects.toThrow("Plugin at plugins[2] must be an object");
  });

  it("fails an invalid explicit entry before any module is imported", async () => {
    const importModule = jest.fn();

    await expect(
      loadConfiguredPlugins(
        [
          new ExplicitPlugin() as unknown as DurableInstrumentationPluginFactory,
        ],
        {
          environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
          importModule,
        },
      ),
    ).rejects.toBeInstanceOf(PluginLoadError);
    expect(importModule).not.toHaveBeenCalled();
  });

  it("accepts a factory entry and calls it no earlier than the provider path does", async () => {
    const createPlugin = jest.fn(() => new ExplicitPlugin());
    const factory = { createPlugin };

    const [loaded] = await loadExplicit(factory);

    expect(loaded).toBe(factory);
    expect(createPlugin).not.toHaveBeenCalled();
  });
});

describe("loadConfiguredPlugins rejects a class where a factory belongs", () => {
  // `plugins: [MyPlugin]` is close enough to correct to look right, and a class
  // is callable, so it would reach the per-invocation call and throw "Class
  // constructor cannot be invoked without 'new'" — once per invocation,
  // swallowed each time, leaving the plugin absent with nothing said about why.
  // A class carries no `createPlugin`, so the shape test rejects it at load time
  // on both paths instead.
  const shapeMessage =
    "must be an object with a 'createPlugin(info)' method that creates a " +
    "plugin for one invocation, but it is a function.";

  it("rejects a class passed directly in plugins, naming its position", async () => {
    await expect(
      loadConfiguredPlugins(
        [ExplicitPlugin as unknown as DurableInstrumentationPluginFactory],
        { environment: {} },
      ),
    ).rejects.toMatchObject({
      name: "PluginLoadError",
      message: expect.stringContaining(`Plugin at plugins[0] ${shapeMessage}`),
    });
  });

  it("names the position of the class among valid factories", async () => {
    const factory = factoryFor(() => new ExplicitPlugin());

    await expect(
      loadConfiguredPlugins(
        [
          factory,
          factory,
          ExplicitPlugin as unknown as DurableInstrumentationPluginFactory,
        ],
        { environment: {} },
      ),
    ).rejects.toThrow(`Plugin at plugins[2] ${shapeMessage}`);
  });

  it("fails a class in plugins before any module is imported", async () => {
    const importModule = jest.fn();

    await expect(
      loadConfiguredPlugins(
        [ExplicitPlugin as unknown as DurableInstrumentationPluginFactory],
        {
          environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
          importModule,
        },
      ),
    ).rejects.toBeInstanceOf(PluginLoadError);
    expect(importModule).not.toHaveBeenCalled();
  });

  it("rejects a class exported as a provider, naming the specifier", async () => {
    await expect(
      loadConfiguredPlugins([], {
        environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
        importModule: async () => moduleFor(FirstDynamicPlugin),
      }),
    ).rejects.toMatchObject({
      name: "PluginLoadError",
      message: expect.stringContaining(
        `Plugin provider '@example/plugin' ${shapeMessage}`,
      ),
    });
  });

  it("rejects a subclass of a plugin", async () => {
    await expect(
      loadConfiguredPlugins(
        [
          class Sub extends ExplicitPlugin {} as unknown as DurableInstrumentationPluginFactory,
        ],
        { environment: {} },
      ),
    ).rejects.toThrow(`Plugin at plugins[0] ${shapeMessage}`);
  });

  it("tells the caller what shape to pass instead", async () => {
    await expect(
      loadConfiguredPlugins(
        [ExplicitPlugin as unknown as DurableInstrumentationPluginFactory],
        { environment: {} },
      ),
    ).rejects.toThrow(
      "Pass a factory such as `{ createPlugin: (info) => new MyPlugin() }`.",
    );
  });

  it("does not call the entry to find out that it is not a factory", async () => {
    // Calling a class throws, and a check that relied on the throw would run
    // arbitrary constructor code for every legitimate factory.
    let constructed = 0;
    class CountingPlugin implements DurableInstrumentationPlugin {
      constructor() {
        constructed += 1;
      }
    }

    await expect(
      loadConfiguredPlugins(
        [CountingPlugin as unknown as DurableInstrumentationPluginFactory],
        { environment: {} },
      ),
    ).rejects.toBeInstanceOf(PluginLoadError);
    expect(constructed).toBe(0);
  });
});

describe("loadConfiguredPlugins rejects a bare function where a factory belongs", () => {
  // A factory is an object with a `createPlugin` method. A bare
  // `(info) => plugin` function has no such member, so it is rejected on both
  // paths: there is no shape that both contracts satisfy, and a caller carrying
  // the older form learns at load time rather than at the first hook.
  const callableShapes: Array<{ desc: string; entry: unknown }> = [
    { desc: "an arrow function", entry: () => new ExplicitPlugin() },
    {
      desc: "a function expression",
      entry: (): ExplicitPlugin => new ExplicitPlugin(),
    },
    {
      desc: "a bound function",
      entry: function make(): ExplicitPlugin {
        return new ExplicitPlugin();
      }.bind(null),
    },
    {
      desc: "a callable object carrying unrelated members",
      entry: Object.assign(() => new ExplicitPlugin(), { label: "callable" }),
    },
  ];

  it.each(callableShapes)("rejects $desc in plugins", async ({ entry }) => {
    await expect(
      loadConfiguredPlugins([entry as DurableInstrumentationPluginFactory], {
        environment: {},
      }),
    ).rejects.toThrow(
      "Plugin at plugins[0] must be an object with a 'createPlugin(info)' method",
    );
  });

  it.each(callableShapes)(
    "rejects $desc as a provider export",
    async ({ entry }) => {
      await expect(
        loadConfiguredPlugins([], {
          environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
          importModule: async () => moduleFor(entry),
        }),
      ).rejects.toThrow(
        "Plugin provider '@example/plugin' must be an object with a 'createPlugin(info)' method",
      );
    },
  );
});

describe("loadConfiguredPlugins accepts every legitimate factory shape", () => {
  // The check is a property lookup for a callable `createPlugin`, so every value
  // the type accepts has to survive it — including the shapes that keep the
  // method somewhere other than on the object itself.
  class FactoryClass {
    createPlugin(): ExplicitPlugin {
      return new ExplicitPlugin();
    }
  }

  const shapes: Array<{ desc: string; entry: unknown }> = [
    {
      desc: "an object literal with a method",
      entry: {
        createPlugin(): ExplicitPlugin {
          return new ExplicitPlugin();
        },
      },
    },
    {
      desc: "an object with an arrow property",
      entry: { createPlugin: (): ExplicitPlugin => new ExplicitPlugin() },
    },
    {
      desc: "a class instance whose method is on the prototype",
      entry: new FactoryClass(),
    },
    {
      desc: "an object inheriting the method from another factory",
      entry: Object.create({
        createPlugin: (): ExplicitPlugin => new ExplicitPlugin(),
      }),
    },
    {
      desc: "a function carrying the method as a property",
      entry: Object.assign(function legacy(): void {}, {
        createPlugin: (): ExplicitPlugin => new ExplicitPlugin(),
      }),
    },
    {
      desc: "a factory carrying unrelated members",
      entry: {
        createPlugin: (): ExplicitPlugin => new ExplicitPlugin(),
        label: "factory",
      },
    },
  ];

  it.each(shapes)("accepts $desc in plugins", async ({ entry }) => {
    const result = await loadConfiguredPlugins(
      [entry as DurableInstrumentationPluginFactory],
      { environment: {} },
    );

    expect(result).toEqual([entry]);
    expect(result[0].createPlugin(invocationInfo)).toBeInstanceOf(
      ExplicitPlugin,
    );
  });

  it.each(shapes)("accepts $desc as a provider export", async ({ entry }) => {
    const result = await loadConfiguredPlugins([], {
      environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
      importModule: async () => moduleFor(entry),
    });

    expect(result).toEqual([entry]);
  });
});

describe("describeValue names what an invalid entry was", () => {
  it("reports an array as an array, not as an object", async () => {
    // `typeof [] === "object"`, so without a dedicated case the message would
    // call an array an object.
    await expect(
      loadConfiguredPlugins([], {
        environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
        importModule: async () =>
          moduleFor([factoryFor(() => new ExplicitPlugin())]),
      }),
    ).rejects.toMatchObject({
      name: "PluginLoadError",
      message: expect.stringContaining("but it is an array."),
    });
  });
});

describe("SDK 3.x legacy provider migration", () => {
  it.each(["explicit", "environment"] as const)(
    "rejects declared v1 providers in %s registration without calling them",
    async (registration) => {
      const createPlugin = jest.fn(() => new FirstDynamicPlugin());
      const legacy = {
        pluginApiVersion: 1,
        pluginType: FirstDynamicPlugin,
        createPlugin,
      };
      const loaded =
        registration === "explicit"
          ? loadConfiguredPlugins([legacy], { environment: {} })
          : loadConfiguredPlugins(undefined, {
              environment: { DURABLE_EXECUTION_PLUGINS: "@example/legacy-v1" },
              importModule: async () => moduleFor(legacy),
            });
      await expect(loaded).rejects.toMatchObject({
        name: "PluginLoadError",
        message: expect.stringContaining("legacy v1 provider contract"),
      });
      await expect(loaded).rejects.toThrow("createPlugin(info)");
      await expect(loaded).rejects.toThrow("fresh plugin for each invocation");
      expect(createPlugin).not.toHaveBeenCalled();
    },
  );

  it.each(["explicit", "environment"] as const)(
    "recognizes legacy metadata whose removed version import is undefined (%s)",
    async (registration) => {
      const createPlugin = jest.fn(() => new FirstDynamicPlugin());
      const legacy = {
        pluginApiVersion: undefined,
        pluginType: FirstDynamicPlugin,
        createPlugin,
      };
      const loaded =
        registration === "explicit"
          ? loadConfiguredPlugins([legacy], { environment: {} })
          : loadConfiguredPlugins(undefined, {
              environment: { DURABLE_EXECUTION_PLUGINS: "@example/legacy-v1" },
              importModule: async () => ({ default: moduleFor(legacy) }),
            });
      await expect(loaded).rejects.toBeInstanceOf(PluginLoadError);
      expect(createPlugin).not.toHaveBeenCalled();
    },
  );

  it("does not call a legacy metadata getter while rejecting its declared contract", async () => {
    const getter = jest.fn(() => {
      throw new Error("should not run");
    });
    const legacy = Object.defineProperty(
      { createPlugin: () => new FirstDynamicPlugin() },
      "pluginApiVersion",
      { get: getter },
    );
    await expect(
      loadConfiguredPlugins([legacy], { environment: {} }),
    ).rejects.toThrow("legacy v1 provider contract");
    expect(getter).not.toHaveBeenCalled();
  });

  it("accepts a migrated factory and creates fresh instances for separate invocations", async () => {
    const createPlugin = jest.fn(() => new FirstDynamicPlugin());
    const [factory] = await loadConfiguredPlugins([{ createPlugin }], {
      environment: {},
    });
    expect(createPlugin).not.toHaveBeenCalled();
    const first = factory.createPlugin(invocationInfo);
    const secondInfo = {
      ...invocationInfo,
      requestId: "next-request",
      isFirstInvocation: false,
    };
    const second = factory.createPlugin(secondInfo);
    expect(first).not.toBe(second);
    expect(createPlugin).toHaveBeenNthCalledWith(1, invocationInfo);
    expect(createPlugin).toHaveBeenNthCalledWith(2, secondInfo);
  });
});

describe("exclusive factory registration", () => {
  function view(name: string, exclusiveGroup = "views") {
    return {
      createPlugin: jest.fn(() => new FirstDynamicPlugin()),
      [DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION]: { name, exclusiveGroup },
    };
  }

  it.each([false, true])(
    "rejects explicit, environment and mixed conflicts without constructing plugins (reverse=%s)",
    async (reverse) => {
      const views = [view("first view"), view("second view")];
      const [first, second] = reverse ? [...views].reverse() : views;
      const modules = { first: moduleFor(first), second: moduleFor(second) };
      const importModule = async (specifier: string) =>
        modules[specifier as keyof typeof modules];
      for (const [explicit, configured] of [
        [[first, second], ""],
        [[], "first,second"],
        [[first], "second"],
      ] as const) {
        await expect(
          loadConfiguredPlugins(explicit, {
            environment: { DURABLE_EXECUTION_PLUGINS: configured },
            importModule,
          }),
        ).rejects.toThrow(
          /Plugins '(first|second) view' and '(first|second) view'.*Configure only one/,
        );
        expect(first.createPlugin).not.toHaveBeenCalled();
        expect(second.createPlugin).not.toHaveBeenCalled();
      }
    },
  );

  it("accepts zero/single views and unrelated factories without eager creation", async () => {
    const first = view("first view");
    const second = view("second view");
    const metrics = view("metrics", "metrics");
    const unrelated = { createPlugin: () => new ExplicitPlugin() };
    for (const factories of [
      [],
      [first],
      [second],
      [first, unrelated],
      [first, metrics],
    ]) {
      await expect(
        loadConfiguredPlugins(factories, { environment: {} }),
      ).resolves.toEqual(factories);
    }
    expect(first.createPlugin).not.toHaveBeenCalled();
    expect(second.createPlugin).not.toHaveBeenCalled();
    expect(metrics.createPlugin).not.toHaveBeenCalled();
  });

  it("rejects the same registered view twice", async () => {
    const factory = view("first view");
    await expect(
      loadConfiguredPlugins([factory, factory], { environment: {} }),
    ).rejects.toBeInstanceOf(PluginLoadError);
    expect(factory.createPlugin).not.toHaveBeenCalled();
  });

  it("ignores ordinary registration properties and unadvertised symbol getters", async () => {
    const getter = {
      createPlugin: () => new ExplicitPlugin(),
      get registration(): never {
        throw new Error("ordinary property");
      },
    };
    const proxy = new Proxy(
      { createPlugin: () => new ExplicitPlugin() },
      {
        get(target, property, receiver) {
          if (typeof property === "symbol") throw new Error("unknown symbol");
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const factories = [
      { createPlugin: () => new ExplicitPlugin(), registration: 42 },
      getter,
      proxy,
    ];
    const loaded = await loadConfiguredPlugins(factories, { environment: {} });
    expect(loaded).toHaveLength(factories.length);
    // Compare identities without Jest itself probing the guarded symbol getter.
    expect(loaded.every((factory, index) => factory === factories[index])).toBe(
      true,
    );
  });
});
