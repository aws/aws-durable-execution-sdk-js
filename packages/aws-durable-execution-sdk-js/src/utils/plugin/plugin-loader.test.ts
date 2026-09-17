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

describe("loadConfiguredPlugins validates explicit entries", () => {
  // Same rule as the provider path: an entry the SDK could never call is a
  // configuration mistake, reported once at load time rather than swallowed on
  // every invocation.
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
        "Plugin at plugins[0] must be a function that creates a plugin for one " +
          `invocation, but it is ${named}. ` +
          "Pass a factory such as `(info) => new MyPlugin()`.",
      ),
    });
  });

  it("names the position of the offending entry", async () => {
    const factory = factoryFor(() => new ExplicitPlugin());

    await expect(
      loadExplicit(factory, factory, new ExplicitPlugin()),
    ).rejects.toThrow("Plugin at plugins[2] must be a function");
  });

  it("fails a non-callable explicit entry before any module is imported", async () => {
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

  it("accepts a callable entry and calls it no earlier than the provider path does", async () => {
    const factory = jest.fn(() => new ExplicitPlugin());

    const [loaded] = await loadExplicit(factory);

    expect(loaded).toBe(factory);
    expect(factory).not.toHaveBeenCalled();
  });
});

describe("loadConfiguredPlugins rejects a class where a factory belongs", () => {
  // `typeof MyPlugin === "function"`, so a class passes the callable check and
  // would only fail when called — once per invocation, swallowed each time. Both
  // paths reject it at load time instead.
  const classMessage =
    "is the plugin class itself, not a function that creates a plugin for one " +
    "invocation. Pass a factory that constructs it, such as " +
    "`(info) => new MyPlugin()`.";

  it("rejects a class passed directly in plugins, naming its position", async () => {
    await expect(
      loadConfiguredPlugins(
        [ExplicitPlugin as unknown as DurableInstrumentationPluginFactory],
        { environment: {} },
      ),
    ).rejects.toMatchObject({
      name: "PluginLoadError",
      message: expect.stringContaining(`Plugin at plugins[0] ${classMessage}`),
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
    ).rejects.toThrow("Plugin at plugins[2] is the plugin class itself");
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
        `Plugin provider '@example/plugin' ${classMessage}`,
      ),
    });
  });

  it.each([
    { desc: "a named class expression", entry: class Named {} },
    { desc: "an anonymous class expression", entry: class {} },
    {
      desc: "a class expression with no space after the keyword",
      // Built at runtime because the formatter inserts the space that this case
      // exists to rule out, so the source text `class{}` cannot be written here.
      entry: new Function("return class{}")(),
    },
    { desc: "a subclass", entry: class Sub extends ExplicitPlugin {} },
  ])("rejects $desc", async ({ entry }) => {
    await expect(
      loadConfiguredPlugins(
        [entry as unknown as DurableInstrumentationPluginFactory],
        { environment: {} },
      ),
    ).rejects.toThrow("Plugin at plugins[0] is the plugin class itself");
  });

  it("tells the caller to pass a factory that constructs the class", async () => {
    await expect(
      loadConfiguredPlugins(
        [ExplicitPlugin as unknown as DurableInstrumentationPluginFactory],
        { environment: {} },
      ),
    ).rejects.toThrow(
      "Pass a factory that constructs it, such as `(info) => new MyPlugin()`.",
    );
  });

  it("does not call the entry to find out that it is a class", async () => {
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

describe("loadConfiguredPlugins accepts every legitimate callable shape", () => {
  // The class check reads source text, so anything callable that is not a class
  // has to survive it — including the shapes whose source text starts with a
  // name rather than a keyword.
  const boundFactory = function make(): ExplicitPlugin {
    return new ExplicitPlugin();
  }.bind(null);

  const methodHolder = {
    make(): ExplicitPlugin {
      return new ExplicitPlugin();
    },
    // Stringifies as `classify() { ... }`, so a check for the `class` prefix
    // alone would reject it.
    classify(): ExplicitPlugin {
      return new ExplicitPlugin();
    },
  };

  class FactoryHolder {
    make(): ExplicitPlugin {
      return new ExplicitPlugin();
    }
  }

  /** Callable, but an instance of a class rather than a plain function. */
  class CallableFactory extends Function {}
  const callableInstance = new Proxy(new CallableFactory(), {
    apply: (): ExplicitPlugin => new ExplicitPlugin(),
  });

  const shapes: Array<{ desc: string; entry: unknown }> = [
    { desc: "an arrow function", entry: () => new ExplicitPlugin() },
    {
      desc: "a function expression",
      entry: function (): ExplicitPlugin {
        return new ExplicitPlugin();
      },
    },
    { desc: "a bound function", entry: boundFactory },
    { desc: "an object method reference", entry: methodHolder.make },
    {
      desc: "a method reference whose name starts with class",
      entry: methodHolder.classify,
    },
    { desc: "a class method reference", entry: new FactoryHolder().make },
    {
      desc: "a class instance with a call signature",
      entry: callableInstance,
    },
    {
      desc: "a callable object",
      entry: Object.assign(() => new ExplicitPlugin(), { label: "callable" }),
    },
  ];

  it.each(shapes)("accepts $desc in plugins", async ({ entry }) => {
    const result = await loadConfiguredPlugins(
      [entry as DurableInstrumentationPluginFactory],
      { environment: {} },
    );

    expect(result).toEqual([entry]);
    expect(result[0](invocationInfo)).toBeInstanceOf(ExplicitPlugin);
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
