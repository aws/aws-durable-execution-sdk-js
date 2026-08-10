import { createRequire } from "module";
import { join } from "path";
import { pathToFileURL } from "url";
import { PluginLoadError } from "../../errors/plugin-load-error/plugin-load-error";
import {
  DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION,
  DurableInstrumentationPlugin,
  DurableInstrumentationPluginProvider,
} from "../../types/plugin";

export const PLUGIN_ENVIRONMENT_VARIABLE = "DURABLE_EXECUTION_PLUGINS";
export const PLUGIN_PROVIDER_EXPORT = "durableExecutionPluginProvider";

type Environment = Readonly<Record<string, string | undefined>>;
type PluginModule = Readonly<Record<string, unknown>>;
type PluginModuleImporter = (specifier: string) => Promise<unknown>;

interface PluginLoaderOptions {
  environment?: Environment;
  importModule?: PluginModuleImporter;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseConfiguredSpecifiers(environment: Environment): string[] {
  const configuredPlugins = environment[PLUGIN_ENVIRONMENT_VARIABLE];
  if (configuredPlugins == null || configuredPlugins.trim() === "") {
    return [];
  }

  const specifiers = configuredPlugins.split(",").map((value) => value.trim());
  if (specifiers.some((specifier) => specifier === "")) {
    throw new PluginLoadError(
      `${PLUGIN_ENVIRONMENT_VARIABLE} must contain non-empty, comma-separated package or module specifiers.`,
    );
  }

  const seen = new Set<string>();
  for (const specifier of specifiers) {
    if (seen.has(specifier)) {
      throw new PluginLoadError(
        `${PLUGIN_ENVIRONMENT_VARIABLE} contains duplicate module specifier '${specifier}'.`,
      );
    }
    seen.add(specifier);
  }

  return specifiers;
}

function createDefaultModuleImporter(
  environment: Environment,
): PluginModuleImporter {
  const applicationRoot = environment.LAMBDA_TASK_ROOT?.trim() || process.cwd();
  const requireFromApplication = createRequire(
    join(applicationRoot, "package.json"),
  );

  return async (specifier: string): Promise<unknown> => {
    try {
      return await import(specifier);
    } catch (importError) {
      try {
        const resolvedPath = requireFromApplication.resolve(specifier);
        return await import(pathToFileURL(resolvedPath).href);
      } catch (layerImportError) {
        throw new AggregateError(
          [importError, layerImportError],
          `Unable to resolve '${specifier}' from the application or configured Node.js module paths.`,
        );
      }
    }
  };
}

function getProviderExport(
  specifier: string,
  importedModule: unknown,
): unknown {
  if (!isRecord(importedModule)) {
    throw new PluginLoadError(
      `Plugin module '${specifier}' did not evaluate to a module namespace object.`,
    );
  }

  const module = importedModule as PluginModule;
  const directProvider = module[PLUGIN_PROVIDER_EXPORT];
  const defaultExport = module.default;
  const nestedProvider = isRecord(defaultExport)
    ? defaultExport[PLUGIN_PROVIDER_EXPORT]
    : undefined;

  const candidates = [directProvider, nestedProvider].filter(
    (candidate, index, values) =>
      candidate !== undefined && values.indexOf(candidate) === index,
  );

  if (candidates.length === 0) {
    throw new PluginLoadError(
      `Plugin module '${specifier}' must export '${PLUGIN_PROVIDER_EXPORT}'.`,
    );
  }
  if (candidates.length > 1) {
    throw new PluginLoadError(
      `Plugin module '${specifier}' exposes multiple different '${PLUGIN_PROVIDER_EXPORT}' values.`,
    );
  }

  return candidates[0];
}

function validateProvider(
  specifier: string,
  providerValue: unknown,
): DurableInstrumentationPluginProvider {
  if (!isRecord(providerValue)) {
    throw new PluginLoadError(
      `Plugin module '${specifier}' exports an invalid provider; expected an object.`,
    );
  }

  if (
    providerValue.pluginApiVersion !==
    DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION
  ) {
    throw new PluginLoadError(
      `Plugin provider '${specifier}' declares plugin API version '${String(providerValue.pluginApiVersion)}', ` +
        `but @aws/durable-execution-sdk-js supports version ${DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION}. ` +
        "Install compatible SDK and plugin package versions.",
    );
  }

  if (
    typeof providerValue.pluginType !== "function" ||
    !isRecord(providerValue.pluginType.prototype)
  ) {
    throw new PluginLoadError(
      `Plugin provider '${specifier}' must declare a constructable 'pluginType'.`,
    );
  }

  if (typeof providerValue.createPlugin !== "function") {
    throw new PluginLoadError(
      `Plugin provider '${specifier}' must define a 'createPlugin' factory function.`,
    );
  }

  return providerValue as unknown as DurableInstrumentationPluginProvider;
}

function createPlugin(
  specifier: string,
  provider: DurableInstrumentationPluginProvider,
): DurableInstrumentationPlugin {
  let plugin: DurableInstrumentationPlugin;
  try {
    plugin = provider.createPlugin();
  } catch (error) {
    throw new PluginLoadError(
      `Plugin provider '${specifier}' failed to create its plugin: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  if (!(plugin instanceof provider.pluginType)) {
    const actualType =
      plugin == null
        ? String(plugin)
        : ((plugin as { constructor?: { name?: string } }).constructor?.name ??
          typeof plugin);
    throw new PluginLoadError(
      `Plugin provider '${specifier}' declared plugin type '${provider.pluginType.name}' ` +
        `but created '${actualType}'.`,
    );
  }

  return plugin;
}

/**
 * Combines explicitly configured plugins with providers selected through the environment.
 *
 * Explicit plugins retain their order. Dynamically selected plugins follow in the order
 * listed in `DURABLE_EXECUTION_PLUGINS`.
 *
 * @internal
 */
export async function loadConfiguredPlugins(
  explicitPlugins: readonly DurableInstrumentationPlugin[] | undefined,
  options: PluginLoaderOptions = {},
): Promise<DurableInstrumentationPlugin[]> {
  const plugins = [...(explicitPlugins ?? [])];
  const environment = options.environment ?? process.env;
  const specifiers = parseConfiguredSpecifiers(environment);
  if (specifiers.length === 0) {
    return plugins;
  }

  const importModule =
    options.importModule ?? createDefaultModuleImporter(environment);

  for (const specifier of specifiers) {
    let importedModule: unknown;
    try {
      importedModule = await importModule(specifier);
    } catch (error) {
      throw new PluginLoadError(
        `Failed to load plugin module '${specifier}': ${errorMessage(error)} ` +
          "Ensure the package is installed in the function artifact or an attached Lambda layer under 'nodejs/node_modules'.",
        { cause: error },
      );
    }

    const provider = validateProvider(
      specifier,
      getProviderExport(specifier, importedModule),
    );
    plugins.push(createPlugin(specifier, provider));
  }

  return plugins;
}
