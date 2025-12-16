import { Command } from "commander";

export interface CliOptions {
  skipTime: boolean;
  verbose: boolean;
  showHistory: boolean;
  handlerExport: string;
}

export interface ParsedCliArgs {
  filePath: string;
  options: CliOptions;
}

/**
 * Configure the Commander.js program
 */
export function createCliProgram(): Command {
  const program = new Command();

  program
    .name("run-durable")
    .description("Run a durable function locally for testing")
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    .version(process.env.NPM_PACKAGE_VERSION!)
    .argument("<file>", "Path to the handler file")
    .option("--skip-time", "Enable skip time in test environment", false)
    .option("-v, --verbose", "Enable verbose logging output", false)
    .option(
      "--show-history",
      "Display execution history events after completion",
      false,
    )
    .option(
      "--handler-export <name>",
      "The exported handler function key",
      "handler",
    );

  return program;
}

/**
 * Parse CLI arguments
 */
export function parseCliArgs(): ParsedCliArgs {
  const program = createCliProgram();
  program.parse();

  const filePath = program.args[0];
  const options = program.opts<CliOptions>();

  return {
    filePath,
    options: {
      skipTime: options.skipTime,
      verbose: options.verbose,
      showHistory: options.showHistory,
      handlerExport: options.handlerExport,
    },
  };
}
