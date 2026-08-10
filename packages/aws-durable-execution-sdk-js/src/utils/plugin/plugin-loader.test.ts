import { PluginLoadError } from "../../errors/plugin-load-error/plugin-load-error";
import {
  DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION,
  DurableInstrumentationPlugin,
  DurableInstrumentationPluginProvider,
} from "../../types/plugin";
import {
  loadConfiguredPlugins,
  PLUGIN_ENVIRONMENT_VARIABLE,
  PLUGIN_PROVIDER_EXPORT,
} from "./plugin-loader";

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

  it("wraps module import failures with layer packaging guidance", async () => {
    const importError = new Error("module not found");

    await expect(
      loadConfiguredPlugins([], {
        environment: {
          [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/missing",
        },
        importModule: async () => {
          throw importError;
        },
      }),
    ).rejects.toMatchObject({
      name: "PluginLoadError",
      message: expect.stringContaining(
        "Ensure the package is installed in the function artifact or an attached Lambda layer",
      ),
      cause: importError,
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
