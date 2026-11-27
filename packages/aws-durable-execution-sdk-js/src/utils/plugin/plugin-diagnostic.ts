/** Names a plugin or factory for a diagnostic, without letting the lookup throw. */
export function pluginIdentity(
  plugin: object,
  index: number,
  list: "plugins" | "factories" = "plugins",
): string {
  try {
    return `${plugin.constructor.name || "Plugin"} (${list}[${index}])`;
  } catch {
    return `${list}[${index}]`;
  }
}

/** Writes a developer diagnostic; a failure to write it never changes the invocation outcome. */
export function warn(
  message: string,
  details: Record<string, string | number>,
): void {
  try {
    // biome-ignore lint/suspicious/noConsole: this diagnostic is for the developer and has no logger here.
    console.warn(message, details);
  } catch {
    // A diagnostic failure must not change the invocation outcome.
  }
}

/** Describes any thrown value, including ones that are not an Error or cannot be converted to a string. */
export function describeThrown(reason: unknown): string {
  try {
    return String(reason);
  } catch {
    return "unprintable value";
  }
}
