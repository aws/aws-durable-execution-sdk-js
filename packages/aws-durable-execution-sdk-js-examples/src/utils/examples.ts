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

    const filesInDir = await fs.readdir(EXAMPLES_DIR, {
      withFileTypes: true,
    });

    const exampleFiles = filesInDir.filter(
      (dirent) => dirent.isFile() && dirent.name.endsWith(".ts"),
    );

    for (const exampleFile of exampleFiles) {
      const examplePath = path.resolve(EXAMPLES_DIR, exampleFile.name);

      const exampleConfig = await Examples.parseExample(
        exampleFile.name,
        examplePath,
      );
      if (!exampleConfig) {
        continue;
      }

      this.examples.push(exampleConfig);
    }

    return this.examples;
  }
}

export const exampleStorage = new Examples();
