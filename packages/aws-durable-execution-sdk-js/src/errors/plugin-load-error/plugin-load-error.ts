/**
 * Error raised when a configured instrumentation plugin cannot be loaded, either
 * from `plugins` or from a module selected through the environment.
 *
 * @beta
 * @experimental This error is experimental and may be changed or removed in future releases.
 */
export class PluginLoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`Plugin configuration failed: ${message}`, options);
    this.name = "PluginLoadError";
  }
}
