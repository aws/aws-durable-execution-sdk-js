import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyOperationsFormat } from "../operations-by-name.js";

// A file name keeps letters, digits, ".", "_" and "-". Every other character becomes "_",
// as in the full SDK. So an execution name or an ARN cannot name a path outside the
// directory.
const fileName = (value) => value.replace(/[^a-zA-Z0-9._-]/g, "_");

// Writes each record to a file in directory, as in the full SDK's FileExporter:
// 1. "ndjson": appends one JSON line to {directory}/{YYYY-MM-DD}.ndjson. The date is the
//    UTC date of emittedAt.
// 2. "json": writes {directory}/{executionName}.json, pretty-printed. A newer record of
//    the same execution replaces the file.
export function createFileExporter({
  directory,
  mode = "ndjson",
  // "array", "by-name" or "both", as in the full SDK. See applyOperationsFormat.
  operationsFormat = "array",
  // A file has no practical size limit. So, as in the full SDK, no default.
  maxRecordBytes,
}) {
  return {
    maxRecordBytes,
    async export(record) {
      // mkdir with recursive does nothing for a directory that exists. The full SDK
      // calls it once per exporter. This exporter calls it on every export, so a
      // removed directory is created again.
      await mkdir(directory, { recursive: true });
      const body = applyOperationsFormat(record, operationsFormat);
      // Any mode other than "ndjson" writes one file per execution, as in the full SDK.
      if (mode === "ndjson") {
        await appendFile(
          join(directory, `${record.emittedAt.slice(0, 10)}.ndjson`),
          `${JSON.stringify(body)}\n`,
        );
        return;
      }
      // executionName is absent when the ARN has no execution name.
      const name = fileName(record.executionName ?? record.executionArn);
      await writeFile(
        join(directory, `${name}.json`),
        JSON.stringify(body, null, 2),
      );
    },
  };
}
