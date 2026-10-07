import { createRequire } from "module";
import { join } from "path";
import { pathToFileURL } from "url";
import { PluginLoadError } from "../../errors/plugin-load-error/plugin-load-error";
import {
  DURABLE_INSTRUMENTATION_PLUGIN_API_VERSION,
  DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION,
  RegisteredDurableInstrumentationPlugin,
  RegisteredDurableInstrumentationPluginType,
  DurableInstrumentationPlugin,
  DurableInstrumentationPluginProvider,
  DurableInstrumentationPluginType,
} from "../../types/plugin";

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
  return error instanceof Error ? error.message : String(error);
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

type PluginRegistration =
  RegisteredDurableInstrumentationPlugin[typeof DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION];

function getRegistrations(
  plugin: DurableInstrumentationPlugin | DurableInstrumentationPluginType,
): readonly PluginRegistration[] {
  const pluginType =
    typeof plugin === "function"
      ? plugin
      : Object.getPrototypeOf(plugin)?.constructor;
  if (
    typeof pluginType === "function" &&
    DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION in pluginType
  ) {
    const concreteType = pluginType as DurableInstrumentationPluginType;
    const registrations: PluginRegistration[] = [];
    const visited = new Set<unknown>();
    let name: string | undefined;
    // A subclass may add a constraint, but cannot replace a base constraint.
    // Only inspect declarations of the opt-in symbol; ordinary properties and
    // unmarked callbacks are not registration metadata.
    for (
      let current: unknown = pluginType;
      typeof current === "function" && !visited.has(current);
      current = Object.getPrototypeOf(current)
    ) {
      visited.add(current);
      if (!Object.hasOwn(current, DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION))
        continue;
      // Preserve the concrete constructor as the receiver for inherited getters.
      const registration = Reflect.get(
        current,
        DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION,
        pluginType,
      ) as
        | RegisteredDurableInstrumentationPluginType[typeof DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION]
        | undefined;
      if (registration) {
        name ??= concreteType.name || "(anonymous)";
        registrations.push({
          name,
          exclusiveGroup: registration.exclusiveGroup,
        });
      }
    }
    if (registrations.length > 0) return registrations;
  }

  // Keep existing instance metadata working. Only declared static metadata can
  // be checked before construction; validate the returned instances as well.
  if (
    typeof plugin !== "function" &&
    DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION in plugin
  ) {
    const registration = (
      plugin as Partial<RegisteredDurableInstrumentationPlugin>
    )[DURABLE_INSTRUMENTATION_PLUGIN_REGISTRATION];
    return registration ? [registration] : [];
  }
  return [];
}

function validateExclusiveGroups(
  plugins: readonly (
    | DurableInstrumentationPlugin
    | DurableInstrumentationPluginType
  )[],
): void {
  const groups = new Map<string, string>();
  for (const plugin of plugins) {
    const registeredGroups = new Set<string>();
    for (const registration of getRegistrations(plugin)) {
      const group = registration.exclusiveGroup;
      if (!group || registeredGroups.has(group)) continue;
      registeredGroups.add(group);
      const previous = groups.get(group);
      if (previous !== undefined) {
        throw new PluginLoadError(
          `Plugins '${previous}' and '${registration.name}' are mutually exclusive in group '${group}'. Configure only one.`,
        );
      }
      groups.set(group, registration.name);
    }
  }
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
  validateExclusiveGroups(plugins);
  if (specifiers.length === 0) {
    return plugins;
  }

  const importModule =
    options.importModule ??
    createDefaultModuleImporter(
      environment,
      options.moduleImporterDependencies,
    );

  const providers: {
    specifier: string;
    provider: DurableInstrumentationPluginProvider;
  }[] = [];
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
    providers.push({ specifier, provider });
  }

  // Resolve and validate the complete configuration before any selected factory
  // runs. In particular, a conflicting bundled OTel pair must not mutate the
  // application's global tracer through its constructors.
  validateExclusiveGroups([
    ...plugins,
    ...providers.map(({ provider }) => provider.pluginType),
  ]);
  for (const { specifier, provider } of providers) {
    plugins.push(createPlugin(specifier, provider));
  }
  // A v1 provider may declare a base class and return a registered subclass.
  validateExclusiveGroups(plugins);
  return plugins;
}
