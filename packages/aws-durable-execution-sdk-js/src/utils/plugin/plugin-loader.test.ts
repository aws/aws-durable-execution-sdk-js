import { PluginLoadError } from "../../errors/plugin-load-error/plugin-load-error";
import {
  DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION,
  DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION,
  DurableInstrumentationPlugin,
  DurableInstrumentationPluginProvider,
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

function providerFor<Plugin extends DurableInstrumentationPlugin>(
  pluginType: abstract new (...args: never[]) => Plugin,
  createPlugin: () => Plugin,
): DurableInstrumentationPluginProvider<Plugin> {
  return {
    pluginApiVersion: DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION,
    pluginType,
    createPlugin,
  };
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
  it("preserves explicit plugins without importing modules when configuration is unset", async () => {
    const explicitPlugin = new ExplicitPlugin();
    const importModule = jest.fn();

    const result = await loadConfiguredPlugins([explicitPlugin], {
      environment: {},
      importModule,
    });

    expect(result).toEqual([explicitPlugin]);
    expect(importModule).not.toHaveBeenCalled();
  });

  it("treats a blank environment variable as disabled", async () => {
    const explicitPlugin = new ExplicitPlugin();
    const importModule = jest.fn();

    const result = await loadConfiguredPlugins([explicitPlugin], {
      environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "  " },
      importModule,
    });

    expect(result).toEqual([explicitPlugin]);
    expect(importModule).not.toHaveBeenCalled();
  });

  it("loads configured providers in order after explicit plugins", async () => {
    const explicitPlugin = new ExplicitPlugin();
    const firstPlugin = new FirstDynamicPlugin();
    const secondPlugin = new SecondDynamicPlugin();
    const modules: Record<string, unknown> = {
      "@example/first": moduleFor(
        providerFor(FirstDynamicPlugin, () => firstPlugin),
      ),
      "@example/second/provider": moduleFor(
        providerFor(SecondDynamicPlugin, () => secondPlugin),
      ),
    };
    const importModule = jest.fn(
      async (specifier: string): Promise<unknown> => modules[specifier],
    );

    const result = await loadConfiguredPlugins([explicitPlugin], {
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
    expect(result).toEqual([explicitPlugin, firstPlugin, secondPlugin]);
  });

  it("keeps explicit and dynamic instances of the same plugin type additive", async () => {
    const explicitPlugin = new FirstDynamicPlugin();
    const dynamicPlugin = new FirstDynamicPlugin();

    const result = await loadConfiguredPlugins([explicitPlugin], {
      environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/first" },
      importModule: async () =>
        moduleFor(providerFor(FirstDynamicPlugin, () => dynamicPlugin)),
    });

    expect(result).toEqual([explicitPlugin, dynamicPlugin]);
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
    const plugin = new FirstDynamicPlugin();
    const provider = providerFor(FirstDynamicPlugin, () => plugin);

    const result = await loadConfiguredPlugins([], {
      environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
      importModule: async () => ({
        default: { [PLUGIN_PROVIDER_EXPORT]: provider },
      }),
    });

    expect(result).toEqual([plugin]);
  });

  it("accepts duplicate ESM and CommonJS views of the same provider export", async () => {
    const plugin = new FirstDynamicPlugin();
    const provider = providerFor(FirstDynamicPlugin, () => plugin);

    const result = await loadConfiguredPlugins([], {
      environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
      importModule: async () => ({
        [PLUGIN_PROVIDER_EXPORT]: provider,
        default: { [PLUGIN_PROVIDER_EXPORT]: provider },
      }),
    });

    expect(result).toEqual([plugin]);
  });

  it("rejects conflicting ESM and CommonJS provider exports", async () => {
    const directProvider = providerFor(
      FirstDynamicPlugin,
      () => new FirstDynamicPlugin(),
    );
    const nestedProvider = providerFor(
      SecondDynamicPlugin,
      () => new SecondDynamicPlugin(),
    );

    await expect(
      loadConfiguredPlugins([], {
        environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
        importModule: async () => ({
          [PLUGIN_PROVIDER_EXPORT]: directProvider,
          default: { [PLUGIN_PROVIDER_EXPORT]: nestedProvider },
        }),
      }),
    ).rejects.toThrow(
      `Plugin module '@example/plugin' exposes multiple different '${PLUGIN_PROVIDER_EXPORT}' values.`,
    );
  });

  it("rejects a non-object provider", async () => {
    await expect(
      loadConfiguredPlugins([], {
        environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
        importModule: async () => moduleFor("not a provider"),
      }),
    ).rejects.toThrow(
      "Plugin module '@example/plugin' exports an invalid provider; expected an object.",
    );
  });

  it("rejects incompatible provider API versions", async () => {
    await expect(
      loadConfiguredPlugins([], {
        environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
        importModule: async () =>
          moduleFor({
            ...providerFor(FirstDynamicPlugin, () => new FirstDynamicPlugin()),
            pluginApiVersion: DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION + 1,
          }),
      }),
    ).rejects.toThrow(
      `supports version ${DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION}`,
    );
  });

  it.each([undefined, null, "FirstDynamicPlugin", (): undefined => undefined])(
    "rejects invalid plugin type %p",
    async (pluginType) => {
      await expect(
        loadConfiguredPlugins([], {
          environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
          importModule: async () =>
            moduleFor({
              pluginApiVersion: DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION,
              pluginType,
              createPlugin: () => new FirstDynamicPlugin(),
            }),
        }),
      ).rejects.toThrow(
        "Plugin provider '@example/plugin' must declare a constructable 'pluginType'.",
      );
    },
  );

  it("rejects a provider without a factory", async () => {
    await expect(
      loadConfiguredPlugins([], {
        environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
        importModule: async () =>
          moduleFor({
            pluginApiVersion: DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION,
            pluginType: FirstDynamicPlugin,
          }),
      }),
    ).rejects.toThrow(
      "Plugin provider '@example/plugin' must define a 'createPlugin' factory function.",
    );
  });

  it("wraps provider construction failures", async () => {
    const constructionError = new Error("missing configuration");

    await expect(
      loadConfiguredPlugins([], {
        environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
        importModule: async () =>
          moduleFor(
            providerFor(FirstDynamicPlugin, (): FirstDynamicPlugin => {
              throw constructionError;
            }),
          ),
      }),
    ).rejects.toMatchObject({
      name: "PluginLoadError",
      message: expect.stringContaining(
        "Plugin provider '@example/plugin' failed to create its plugin",
      ),
      cause: constructionError,
    });
  });

  it("rejects a plugin that does not match the declared type", async () => {
    await expect(
      loadConfiguredPlugins([], {
        environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
        importModule: async () =>
          moduleFor(
            providerFor(
              FirstDynamicPlugin,
              () => new SecondDynamicPlugin() as unknown as FirstDynamicPlugin,
            ),
          ),
      }),
    ).rejects.toThrow(
      "declared plugin type 'FirstDynamicPlugin' but created 'SecondDynamicPlugin'",
    );
  });

  it("uses PluginLoadError for configuration failures", async () => {
    await expect(
      loadConfiguredPlugins([], {
        environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "," },
      }),
    ).rejects.toBeInstanceOf(PluginLoadError);
  });
});

describe("exclusive plugin registration", () => {
  class First implements DurableInstrumentationPlugin {
    async onInvocationStart(): Promise<void> {}
    readonly [DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION] = {
      name: "first view",
      exclusiveGroup: "views",
    };
  }
  class Second implements DurableInstrumentationPlugin {
    async onInvocationStart(): Promise<void> {}
    readonly [DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION] = {
      name: "second view",
      exclusiveGroup: "views",
    };
  }
  const factories = [() => new First(), () => new Second()];
  it.each([false, true])(
    "rejects explicit, dynamic and mixed conflicts (reverse=%s)",
    async (reverse) => {
      const [first, second] = reverse ? [...factories].reverse() : factories;
      const modules = {
        first: moduleFor(
          providerFor(first().constructor as typeof First, first),
        ),
        second: moduleFor(
          providerFor(second().constructor as typeof Second, second),
        ),
      };
      const importModule = async (specifier: string) =>
        modules[specifier as keyof typeof modules];
      for (const [explicit, configured] of [
        [[first(), second()], ""],
        [[], "first,second"],
        [[first()], "second"],
      ] as const) {
        await expect(
          loadConfiguredPlugins(explicit, {
            environment: { DURABLE_EXECUTION_PLUGINS: configured },
            importModule,
          }),
        ).rejects.toThrow(
          /Plugins '(first|second) view' and '(first|second) view'.*Configure only one/,
        );
      }
    },
  );
  it("allows no view, either single view, and unrelated plugins", async () => {
    for (const plugins of [
      [],
      [new First()],
      [new Second()],
      [new First(), new ExplicitPlugin()],
      [
        new First(),
        {
          async onInvocationStart() {},
          [DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION]: {
            name: "metrics",
            exclusiveGroup: "metrics",
          },
        },
      ],
    ]) {
      await expect(
        loadConfiguredPlugins(plugins, { environment: {} }),
      ).resolves.toEqual(plugins);
    }
  });
  it("rejects two registrations of the same view", async () => {
    await expect(
      loadConfiguredPlugins([new First(), new First()], { environment: {} }),
    ).rejects.toThrow(PluginLoadError);
  });
});

describe("legacy unrelated registration properties", () => {
  it("does not interpret or read an ordinary registration field", async () => {
    class LegacyPlugin implements DurableInstrumentationPlugin {
      registration = 42;
      async onInvocationStart() {}
    }
    const getter = {
      async onInvocationStart() {},
      get registration(): never {
        throw new Error("not SDK metadata");
      },
    };
    const plugins = [new LegacyPlugin(), getter];
    await expect(
      loadConfiguredPlugins(plugins, { environment: {} }),
    ).resolves.toEqual(plugins);
  });

  it("does not call an unmarked registration callback", async () => {
    const registration = jest.fn(() => ({ exclusiveGroup: "views" }));
    const plugin = { registration, async onInvocationStart() {} };
    await expect(
      loadConfiguredPlugins([plugin, plugin], { environment: {} }),
    ).resolves.toEqual([plugin, plugin]);
    expect(registration).not.toHaveBeenCalled();
  });
});

describe("static exclusive plugin registration", () => {
  class First implements DurableInstrumentationPlugin {
    static readonly [DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION] = {
      exclusiveGroup: "views",
    };
    async onInvocationStart(): Promise<void> {}
  }
  class Second implements DurableInstrumentationPlugin {
    static readonly [DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION] = {
      exclusiveGroup: "views",
    };
    async onInvocationStart(): Promise<void> {}
  }

  it.each([false, true])(
    "rejects dynamic and mixed conflicts before any selected factory runs (reverse=%s)",
    async (reverse) => {
      const [A, B] = reverse ? [Second, First] : [First, Second];
      for (const mixed of [false, true]) {
        const unrelated = jest.fn(() => new ExplicitPlugin());
        const first = jest.fn(() => new A());
        const second = jest.fn(() => new B());
        const modules = {
          unrelated: moduleFor(providerFor(ExplicitPlugin, unrelated)),
          first: moduleFor(providerFor(A, first)),
          second: moduleFor(providerFor(B, second)),
        };
        await expect(
          loadConfiguredPlugins(mixed ? [new A()] : [], {
            environment: {
              DURABLE_EXECUTION_PLUGINS: mixed
                ? "unrelated,second"
                : "unrelated,first,second",
            },
            importModule: async (specifier) =>
              modules[specifier as keyof typeof modules],
          }),
        ).rejects.toThrow(/Plugins '(First|Second)' and '(First|Second)'/);
        expect(unrelated).not.toHaveBeenCalled();
        expect(first).not.toHaveBeenCalled();
        expect(second).not.toHaveBeenCalled();
      }
    },
  );

  it("inherits exclusivity and names the actual subclasses", async () => {
    class CustomFirst extends First {}
    class CustomSecond extends Second {}
    await expect(
      loadConfiguredPlugins([new CustomFirst(), new CustomSecond()], {
        environment: {},
      }),
    ).rejects.toThrow("Plugins 'CustomFirst' and 'CustomSecond'");
  });

  it.each([false, true])(
    "retains inherited constraints when a subclass declares its own group (reverse=%s)",
    async (reverse) => {
      class RegroupedFirst extends First {
        static readonly [DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION] = {
          exclusiveGroup: "custom",
        };
      }
      const classes = reverse
        ? [Second, RegroupedFirst]
        : [RegroupedFirst, Second];
      for (const explicitCount of [0, 1, 2]) {
        const factories = classes.map((Plugin) => jest.fn(() => new Plugin()));
        await expect(
          loadConfiguredPlugins(
            classes.slice(0, explicitCount).map((Plugin) => new Plugin()),
            {
              environment: {
                DURABLE_EXECUTION_PLUGINS: ["first", "second"]
                  .slice(explicitCount)
                  .join(","),
              },
              importModule: async (specifier) => {
                const i = specifier === "first" ? 0 : 1;
                return moduleFor(providerFor(classes[i], factories[i]));
              },
            },
          ),
        ).rejects.toThrow("group 'views'");
        for (const factory of factories) expect(factory).not.toHaveBeenCalled();
      }
    },
  );

  it("enforces added groups throughout the constructor chain", async () => {
    class Middle extends First {
      static readonly [DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION] = {
        exclusiveGroup: "middle",
      };
    }
    class Leaf extends Middle {
      static readonly [DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION] = {
        exclusiveGroup: "leaf",
      };
    }
    const plugin = new Leaf();
    await expect(
      loadConfiguredPlugins([plugin], { environment: {} }),
    ).resolves.toEqual([plugin]);
    for (const exclusiveGroup of ["views", "middle", "leaf"]) {
      const other = {
        async onInvocationStart() {},
        [DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION]: {
          name: "other",
          exclusiveGroup,
        },
      };
      await expect(
        loadConfiguredPlugins([plugin, other], { environment: {} }),
      ).rejects.toThrow(`group '${exclusiveGroup}'`);
    }
  });

  it("deduplicates repeated inherited groups within one registration", async () => {
    class Repeated extends First {
      static readonly [DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION] = {
        exclusiveGroup: "views",
      };
    }
    const plugin = new Repeated();
    await expect(
      loadConfiguredPlugins([plugin], { environment: {} }),
    ).resolves.toEqual([plugin]);
    await expect(
      loadConfiguredPlugins([plugin, plugin], { environment: {} }),
    ).rejects.toThrow("group 'views'");
  });

  it("preserves the concrete receiver of inherited metadata getters", async () => {
    class Base implements DurableInstrumentationPlugin {
      static get [DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION]() {
        // biome-ignore lint/complexity/noThisInStatic: This checks the concrete receiver of inherited metadata getters.
        return { exclusiveGroup: `getter:${this.name}` };
      }
      async onInvocationStart() {}
    }
    class Child extends Base {}
    const other = {
      async onInvocationStart() {},
      [DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION]: {
        name: "other",
        exclusiveGroup: "getter:Child",
      },
    };
    await expect(
      loadConfiguredPlugins([new Child(), other], { environment: {} }),
    ).rejects.toThrow("group 'getter:Child'");
  });

  it("validates actual subclasses returned by broader provider declarations", async () => {
    class Base implements DurableInstrumentationPlugin {
      async onInvocationStart(): Promise<void> {}
    }
    class A extends Base {
      static readonly [DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION] = {
        exclusiveGroup: "views",
      };
    }
    class B extends A {}
    const modules = {
      first: moduleFor(providerFor(Base, () => new A())),
      second: moduleFor(providerFor(Base, () => new B())),
    };
    await expect(
      loadConfiguredPlugins([], {
        environment: { DURABLE_EXECUTION_PLUGINS: "first,second" },
        importModule: async (specifier) =>
          modules[specifier as keyof typeof modules],
      }),
    ).rejects.toThrow("Plugins 'A' and 'B'");
  });

  it("constructs each valid dynamic plugin once and retains its instance", async () => {
    const plugin = new First();
    const create = jest.fn(() => plugin);
    const result = await loadConfiguredPlugins([], {
      environment: { DURABLE_EXECUTION_PLUGINS: "first" },
      importModule: async () => moduleFor(providerFor(First, create)),
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toEqual([plugin]);
    expect(result[0]).toBe(plugin);
  });
});

it("does not probe symbol getters on legacy plugins that did not opt into registration metadata", async () => {
  const legacy = new Proxy(
    { async onInvocationStart() {} },
    {
      get(target, property, receiver) {
        if (typeof property === "symbol")
          throw new Error("unsupported symbol getter");
        return Reflect.get(target, property, receiver);
      },
    },
  );
  const result = await loadConfiguredPlugins([legacy], { environment: {} });
  expect(result[0]).toBe(legacy);
});
