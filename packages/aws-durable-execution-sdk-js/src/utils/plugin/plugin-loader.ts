import { createRequire } from "module";
import { join } from "path";
import { pathToFileURL } from "url";
import { PluginLoadError } from "../../errors/plugin-load-error/plugin-load-error";
import {
  DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION,
  DurableInstrumentationPlugin,
  DurableInstrumentationPluginProvider,
} from "../../types/plugin";
import { isErrorLike } from "../error-object/is-error-like";

export const PLUGIN_ENVIRONMENT_VARIABLE = "DURABLE_EXECUTION_PLUGINS";
export const PLUGIN_PROVIDER_EXPORT = "durableExecutionPluginProvider";

type Environment = Readonly<Record<string, string | undefined>>;
type PluginModule = Readonly<Record<string, unknown>>;
type PluginModuleImporter = (specifier: string) => Promise<unknown>;
type PluginModuleResolver = (specifier: string) => string;

interface ModuleImporterDependencies {
  importModule?: PluginModuleImporter;
  resolveModule?: PluginModuleResolver;
}

interface PluginLoaderOptions {
  environment?: Environment;
  importModule?: PluginModuleImporter;
  moduleImporterDependencies?: ModuleImporterDependencies;
}

class PluginModuleResolutionError extends AggregateError {
  constructor(specifier: string, errors: readonly unknown[]) {
    super(
      errors,
      `Unable to resolve '${specifier}' from the application or configured Node.js module paths.`,
    );
    this.name = "PluginModuleResolutionError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return isErrorLike(error) ? error.message : String(error);
}

function packageNameFromSpecifier(specifier: string): string | undefined {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier)
  ) {
    return undefined;
  }

  const segments = specifier.split("/");
  return specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0];
}

function isConfiguredSpecifierNotFound(
  error: unknown,
  specifier: string,
): boolean {
  if (!isRecord(error)) {
    return false;
  }

  if (
    error.code !== "ERR_MODULE_NOT_FOUND" &&
    error.code !== "MODULE_NOT_FOUND"
  ) {
    return false;
  }

  const message = errorMessage(error);
  const targets = new Set(
    [specifier, packageNameFromSpecifier(specifier)].filter(
      (target): target is string => target != null && target !== "",
    ),
  );

  return [...targets].some((target) =>
    [
      `Cannot find package '${target}'`,
      `Cannot find package "${target}"`,
      `Cannot find module '${target}'`,
      `Cannot find module "${target}"`,
    ].some((prefix) => message.includes(prefix)),
  );
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

/** @internal */
export function createDefaultModuleImporter(
  environment: Environment,
  dependencies: ModuleImporterDependencies = {},
): PluginModuleImporter {
  const applicationRoot = environment.LAMBDA_TASK_ROOT?.trim() || process.cwd();
  const requireFromApplication = createRequire(
    join(applicationRoot, "package.json"),
  );
  const importModule =
    dependencies.importModule ??
    ((specifier: string): Promise<unknown> => import(specifier));
  const resolveModule =
    dependencies.resolveModule ??
    ((specifier: string): string => requireFromApplication.resolve(specifier));

  return async (specifier: string): Promise<unknown> => {
    try {
      return await importModule(specifier);
    } catch (importError) {
      if (!isConfiguredSpecifierNotFound(importError, specifier)) {
        throw importError;
      }

      let resolvedPath: string;
      try {
        resolvedPath = resolveModule(specifier);
      } catch (resolveError) {
        throw new PluginModuleResolutionError(specifier, [
          importError,
          resolveError,
        ]);
      }

      return importModule(pathToFileURL(resolvedPath).href);
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
    options.importModule ??
    createDefaultModuleImporter(
      environment,
      options.moduleImporterDependencies,
    );

  for (const specifier of specifiers) {
    let importedModule: unknown;
    try {
      importedModule = await importModule(specifier);
    } catch (error) {
      const packagingGuidance =
        error instanceof PluginModuleResolutionError
          ? " Ensure the package is installed in the function artifact or an attached Lambda layer under 'nodejs/node_modules'."
          : "";
      throw new PluginLoadError(
        `Failed to load plugin module '${specifier}': ${errorMessage(error)}${packagingGuidance}`,
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
