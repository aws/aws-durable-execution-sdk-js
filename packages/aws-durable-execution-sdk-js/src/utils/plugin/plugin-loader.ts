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
 * Checks the one thing about a configured plugin entry that is still worth
 * checking: the value is callable, so the SDK can call it once per invocation.
 *
 * Nothing else about the value can be established here. What a factory returns
 * is only known when it runs, and by then the invocation has started, where a
 * plugin failure is contained rather than fatal. A non-callable entry, by
 * contrast, is a configuration or packaging mistake that would otherwise be
 * rediscovered — and swallowed — on every invocation, so it fails the load
 * instead.
 *
 * Applied to both ways a plugin arrives, so the two paths agree: an entry in
 * `plugins` that is not callable fails the load exactly as an environment-
 * selected provider that is not callable does. `subject` is what the message
 * names, since one path has a module specifier and the other has a position in
 * the caller's array.
 */
function validatePluginFactory(
  subject: string,
  providerValue: unknown,
  guidance = "",
): DurableInstrumentationPluginFactory {
  if (typeof providerValue !== "function") {
    throw new PluginLoadError(
      `${subject} must be a function that creates a plugin for one ` +
        `invocation, but it is ${describeValue(providerValue)}.${guidance}`,
    );
  }

  return providerValue as DurableInstrumentationPluginFactory;
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
 * checked once: that it is callable. An entry that is not — a plugin instance,
 * or a value that is not a function at all — could never produce an instance, so
 * it fails the load rather than being rediscovered and swallowed on every
 * invocation.
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
      " Pass a factory such as `(info) => new MyPlugin()`.",
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
