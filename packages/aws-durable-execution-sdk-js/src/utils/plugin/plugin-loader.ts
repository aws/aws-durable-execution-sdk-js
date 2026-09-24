import { createRequire } from "module";
import { join } from "path";
import { pathToFileURL } from "url";
import { PluginLoadError } from "../../errors/plugin-load-error/plugin-load-error";
import { DurableInstrumentationPluginFactory } from "../../types/plugin";

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

/**
 * Whether a value can serve as a plugin factory: it exposes a callable
 * `createPlugin`.
 *
 * Only a property lookup is performed, so an inherited method counts. A factory
 * written as a class instance keeps `createPlugin` on its prototype, and its
 * type says it is a factory, so the check has to agree. Functions are examined
 * as well as objects, because a function carrying a `createPlugin` property also
 * satisfies the interface.
 */
function isPluginFactory(
  value: unknown,
): value is DurableInstrumentationPluginFactory {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return false;
  }

  return (
    typeof (value as { createPlugin?: unknown }).createPlugin === "function"
  );
}

/**
 * Checks the one thing about a configured plugin entry that can be checked
 * without running it: the entry carries a callable `createPlugin`, which is what
 * the SDK calls once per invocation.
 *
 * The shape test also rejects the values a caller is most likely to pass by
 * mistake. A plugin instance is an object without `createPlugin`. The plugin
 * class itself is callable but has no `createPlugin` either, so it is rejected
 * here rather than throwing "Class constructor cannot be invoked without 'new'"
 * once per invocation. A bare `(info) => plugin` function, which an earlier
 * version of this contract accepted, has no `createPlugin` either, so the
 * message names the shape that replaces it.
 *
 * The value is never called to find out whether it is a factory. Calling it
 * would run arbitrary constructor or factory code at load time, for every
 * legitimate entry.
 *
 * Nothing else about the value can be established here. What `createPlugin`
 * returns is only known when it runs, and by then the invocation has started,
 * where a plugin failure is contained rather than fatal. A value without
 * `createPlugin`, by contrast, is a configuration or packaging mistake that
 * would otherwise be rediscovered — and swallowed — on every invocation, so it
 * fails the load instead.
 *
 * Applied to both ways a plugin arrives, so the two paths agree: an entry in
 * `plugins` that has no `createPlugin` fails the load exactly as an
 * environment-selected provider without one does. `subject` is what the message
 * names, since one path has a module specifier and the other has a position in
 * the caller's array.
 */
function validatePluginFactory(
  subject: string,
  providerValue: unknown,
  guidance = "",
): DurableInstrumentationPluginFactory {
  if (!isPluginFactory(providerValue)) {
    throw new PluginLoadError(
      `${subject} must be an object with a 'createPlugin(info)' method that ` +
        `creates a plugin for one invocation, but it is ` +
        `${describeValue(providerValue)}.${guidance}`,
    );
  }

  return providerValue;
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  // `typeof []` is "object", so arrays need their own case to be named
  // accurately.
  if (Array.isArray(value)) return "an array";
  const type = typeof value;
  return type === "object" ? "an object" : `a ${type}`;
}

/**
 * Combines explicitly configured plugin factories with providers selected
 * through the environment.
 *
 * Explicit factories retain their order. Dynamically selected providers follow
 * in the order listed in `DURABLE_EXECUTION_PLUGINS`.
 *
 * Every entry from either source is checked here for the one thing that can be
 * checked once: that it carries a callable `createPlugin`. An entry that fails —
 * a plugin instance, the plugin class itself, a bare factory function, or a value
 * that is not an object at all — could never produce an instance, so it fails the
 * load rather than being rediscovered and swallowed on every invocation.
 *
 * Every returned entry is a factory: no plugin is constructed here. Construction
 * happens once per invocation, in {@link createInvocationPluginRunner}, which is
 * what bounds a plugin instance's lifetime to a single invocation.
 *
 * @internal
 */
export async function loadConfiguredPlugins(
  explicitPlugins: readonly DurableInstrumentationPluginFactory[] | undefined,
  options: PluginLoaderOptions = {},
): Promise<DurableInstrumentationPluginFactory[]> {
  const plugins = (explicitPlugins ?? []).map((plugin, index) =>
    validatePluginFactory(
      `Plugin at plugins[${index}]`,
      plugin,
      " Pass a factory such as `{ createPlugin: (info) => new MyPlugin() }`.",
    ),
  );
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

    plugins.push(
      validatePluginFactory(
        `Plugin provider '${specifier}'`,
        getProviderExport(specifier, importedModule),
      ),
    );
  }

  return plugins;
}
