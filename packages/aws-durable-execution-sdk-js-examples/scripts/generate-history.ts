import { exampleStorage } from "../src/utils";
import fs from "fs";
import path from "path";
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { ArgumentParser } from "argparse";

async function main() {
  const parser = new ArgumentParser({
    description: "Generate history files for durable execution examples",
  });

  parser.add_argument("--pattern", {
    type: "str",
    required: true,
    help: "String pattern to generate history for a specific example that matches the pattern (default: generate all examples)",
  });

  parser.add_argument("--log", {
    action: "store_true",
    help: "Log the history events to the console",
  });

  parser.add_argument("--no-skip-time", {
    action: "store_true",
    help: "Do not skip time in test environment (default: skip time)",
  });

  parser.add_argument("--suffix", {
    help: "Optional suffix for test case",
    type: "str",
  });

  parser.add_argument("--payload", {
    help: "Optional payload for test case",
    type: "str",
  });

  const args = parser.parse_args();

  const pattern = args.pattern;
  const logEvents = args.log;
  const skipTime = !args.no_skip_time;
  const suffix = args.suffix;

  const examples = await exampleStorage.getExamples();

  const filteredExamples = pattern
    ? examples.filter((example) => example.path.includes(pattern))
    : examples;

  if (pattern && filteredExamples.length === 0) {
    console.log(`No examples found matching pattern: ${pattern}`);
    return;
  }

  if (pattern) {
    console.log(
      `Found ${filteredExamples.length} example(s) matching pattern "${pattern}":`,
    );
    filteredExamples.forEach((example) => console.log(`  - ${example.name}`));
  } else {
    console.log(
      `Generating history for all ${filteredExamples.length} examples`,
    );
  }

  try {
    await LocalDurableTestRunner.setupTestEnvironment({
      skipTime: skipTime,
    });
    for (const example of filteredExamples) {
      if (example.path.includes("callback") || !example.durableConfig) {
        console.log("Skipping example", example.name);
        continue;
      }
      console.log(`Generating history for ${example.name}`);
      try {
        const runner = new LocalDurableTestRunner({
          handlerFunction: (await import(example.path)).handler,
        });
        const result = await runner.run({
          payload: args.payload ? JSON.parse(args.payload) : undefined,
        });

        const exampleDir = path.dirname(example.path);
        const exampleBaseName =
          path.basename(example.path, path.extname(example.path)) +
          (suffix ? `-${suffix}` : ``);

        const historyEvents = result.getHistoryEvents();

        const outputPath = `${exampleDir}/${exampleBaseName}.history.json`;

        console.log(`Output: ${outputPath}`);
        fs.writeFileSync(outputPath, JSON.stringify(historyEvents, null, 2));

        if (logEvents) {
          console.log(
            `History events for ${example.name}:`,
            JSON.stringify(historyEvents, null, 2),
          );
        }
      } catch (err) {
        console.log(`Error generating history for ${example.name}`, err);
      }
    }
  } finally {
    await LocalDurableTestRunner.teardownTestEnvironment();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
