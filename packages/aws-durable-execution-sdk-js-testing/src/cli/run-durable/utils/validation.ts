import { resolve } from "path";
import { existsSync } from "fs";
import { pathToFileURL } from "url";
import type { DurableLambdaHandler } from "@aws/durable-execution-sdk-js";

export interface ValidatedHandler {
  handler: DurableLambdaHandler;
  absolutePath: string;
}

/**
 * Helper function to create multiline error messages
 */
export function createErrorMessage(lines: string[]): string {
  return lines.join("\n");
}

/**
 * Validates file existence and returns absolute path
 */
export function validateFilePath(filePath: string): string {
  const absolutePath = resolve(process.cwd(), filePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Error: File not found: ${filePath}`);
  }

  return absolutePath;
}

/**
 * Loads and validates handler from module
 */
export async function loadAndValidateHandler(
  absolutePath: string,
  handlerExport: string,
  filePath: string,
): Promise<DurableLambdaHandler> {
  const module = await loadModuleFromPath(absolutePath);

  if (typeof module !== "object" || !module || !(handlerExport in module)) {
    throw new Error(
      `Error: Export '${handlerExport}' not found in ${filePath}`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const handlerCandidate = (module as Record<string, unknown>)[handlerExport];

  if (!handlerCandidate) {
    throw new Error(
      createErrorMessage([
        `Error: No handler function found in ${filePath}`,
        `Expected an export with key ${handlerExport}`,
      ]),
    );
  }

  if (typeof handlerCandidate !== "function") {
    throw new Error(
      `Error: Handler must be a function, got ${typeof handlerCandidate}`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return handlerCandidate as DurableLambdaHandler;
}

/**
 * Load module from file path
 */
export const loadModuleFromPath = async (
  filePath: string,
): Promise<unknown> => {
  const module = (await import(pathToFileURL(filePath).href)) as unknown;
  return module;
};

/**
 * Set up environment variables based on CLI options
 */
export function setupEnvironment(verbose: boolean): void {
  if (verbose) {
    process.env.DURABLE_VERBOSE_MODE = "true";
  }
}
