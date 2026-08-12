/**
 * Error raised when an environment-selected instrumentation plugin cannot be loaded.
 *
 * @beta
 * @experimental This error is experimental and may be changed or removed in future releases.
 */
export class PluginLoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`Dynamic plugin configuration failed: ${message}`, options);
    this.name = "PluginLoadError";
  }
}
