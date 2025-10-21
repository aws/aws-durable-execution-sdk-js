import { exampleStorage } from "../src/utils";
import { writeFile } from "fs/promises";
import path from "path";

async function main() {
  const examples = await exampleStorage.getExamples();

  await writeFile(
    path.resolve(__dirname, "../src/utils/examples-catalog.json"),
    JSON.stringify(examples, null, 2),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
