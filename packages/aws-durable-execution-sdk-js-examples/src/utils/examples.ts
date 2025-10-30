import path from "path";
import fs from "fs/promises";
import { DurableConfig } from "@aws-sdk/client-lambda";
import { ExamplesWithConfig } from "../types";

const EXAMPLES_DIR = path.resolve(__dirname, "../examples");

const DEFAULT_DURABLE_CONFIG: DurableConfig = {
  ExecutionTimeout: 60,
  RetentionPeriodInDays: 7,
};

export class Examples {
  private examples: ExamplesWithConfig[] = [];

  static async parseExample(
    fileName: string,
    examplePath: string,
  ): Promise<ExamplesWithConfig | undefined> {
    const { handler, config } = (await import(examplePath)) as {
      handler: unknown;
      config: unknown;
    };

    // Skip files that don't have a handler export
    if (!handler) {
      return undefined;
    }

    const handlerName =
      fileName.slice(0, fileName.lastIndexOf(".ts")) + ".handler";
    if (!config) {
      throw new Error(`Missing required "config" export in ${fileName}`);
    }

    if (
      typeof config !== "object" ||
      !("name" in config) ||
      typeof config.name !== "string"
    ) {
      throw new Error(`Invalid config object for ${fileName}`);
    }

    const description =
      "description" in config && typeof config.description === "string"
        ? config.description
        : undefined;

    return {
      name: config.name,
      description,
      path: examplePath,
      handler: handlerName,
      durableConfig: DEFAULT_DURABLE_CONFIG,
    };
  }

  async getExamples() {
    if (this.examples.length) {
      return this.examples;
    }

    const dirEntries = await fs.readdir(EXAMPLES_DIR, {
      withFileTypes: true,
    });

    // Filter out non-directories and special directories
    const exampleDirs = dirEntries.filter(
      (dirent) =>
        dirent.isDirectory() &&
        dirent.name !== "shared" &&
        !dirent.name.startsWith("."),
    );

    for (const dir of exampleDirs) {
      const dirPath = path.resolve(EXAMPLES_DIR, dir.name);
      const subEntries = await fs.readdir(dirPath, {
        withFileTypes: true,
      });

      // Check if this directory contains TypeScript files directly (standalone examples)
      const directTsFiles = subEntries.filter(
        (dirent) =>
          dirent.isFile() &&
          dirent.name.endsWith(".ts") &&
          !dirent.name.endsWith(".test.ts"),
      );

      if (directTsFiles.length > 0) {
        // Standalone example directory
        for (const exampleFile of directTsFiles) {
          const examplePath = path.resolve(dirPath, exampleFile.name);

          const exampleConfig = await Examples.parseExample(
            exampleFile.name,
            examplePath,
          );
          if (!exampleConfig) {
            continue;
          }

          this.examples.push(exampleConfig);
        }
      } else {
        // Nested structure - scan subdirectories
        const subDirs = subEntries.filter((dirent) => dirent.isDirectory());

        for (const subDir of subDirs) {
          const subDirPath = path.resolve(dirPath, subDir.name);
          const filesInSubDir = await fs.readdir(subDirPath, {
            withFileTypes: true,
          });

          // Find TypeScript files (excluding test files)
          const exampleFiles = filesInSubDir.filter(
            (dirent) =>
              dirent.isFile() &&
              dirent.name.endsWith(".ts") &&
              !dirent.name.endsWith(".test.ts"),
          );

          for (const exampleFile of exampleFiles) {
            const examplePath = path.resolve(subDirPath, exampleFile.name);

            const exampleConfig = await Examples.parseExample(
              exampleFile.name,
              examplePath,
            );
            if (!exampleConfig) {
              continue;
            }

            this.examples.push(exampleConfig);
          }
        }
      }
    }

    return this.examples;
  }
}

export const exampleStorage = new Examples();
