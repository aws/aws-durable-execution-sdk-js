import { pathToFileURL } from "url";

/**
 * Load module from file path
 *
 * Kept in its own module so tests can replace it: ES module bindings inside a
 * single file cannot be intercepted by spying on that file's exports.
 */
export const loadModuleFromPath = async (
  filePath: string,
): Promise<unknown> => {
  const module = (await import(pathToFileURL(filePath).href)) as unknown;
  return module;
};
