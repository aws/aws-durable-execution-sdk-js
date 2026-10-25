import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFileExporter } from "../src/exporters/file.js";
import { buildRecord } from "../src/index.js";
import { applyOperationsFormat } from "../src/operations-by-name.js";
import { ARN } from "./helpers.js";

const makeRecord = ({
  arn = ARN,
  emittedAt = "2026-01-01T00:00:10.000Z",
} = {}) =>
  buildRecord({
    arn,
    status: "SUCCEEDED",
    emittedAt: new Date(emittedAt),
    operations: [
      { Id: "e", Type: "EXECUTION", Status: "STARTED", StartTimestamp: 1 },
      {
        Id: "1",
        Name: "charge",
        Type: "STEP",
        Status: "SUCCEEDED",
        StartTimestamp: 1,
        EndTimestamp: 2,
      },
    ],
  });
const record = makeRecord();

// A directory under os.tmpdir() that the test removes at its end. The exporter writes
// to a subdirectory that does not exist yet.
const tempDir = async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lite-telemetry-file-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return join(root, "a", "b");
};

test("the default mode appends one JSON line per record to the UTC date's file", async (t) => {
  const directory = await tempDir(t);
  const exporter = createFileExporter({ directory });
  assert.equal(exporter.maxRecordBytes, undefined);
  const second = makeRecord({ emittedAt: "2026-01-01T23:59:59.999Z" });
  const nextDay = makeRecord({ emittedAt: "2026-01-02T00:00:00.000Z" });
  await exporter.export(record);
  await exporter.export(second);
  await exporter.export(nextDay);
  assert.deepEqual((await readdir(directory)).sort(), [
    "2026-01-01.ndjson",
    "2026-01-02.ndjson",
  ]);
  // The default "array" format writes the record unchanged.
  assert.equal(
    await readFile(join(directory, "2026-01-01.ndjson"), "utf8"),
    `${JSON.stringify(record)}\n${JSON.stringify(second)}\n`,
  );
  assert.equal(
    await readFile(join(directory, "2026-01-02.ndjson"), "utf8"),
    `${JSON.stringify(nextDay)}\n`,
  );
});

test('mode "json" writes one pretty-printed file per execution; a newer record replaces it', async (t) => {
  const directory = await tempDir(t);
  const exporter = createFileExporter({ directory, mode: "json" });
  await exporter.export(record);
  const newer = makeRecord({ emittedAt: "2026-01-01T00:00:20.000Z" });
  await exporter.export(newer);
  assert.deepEqual(await readdir(directory), ["local.json"]);
  assert.equal(
    await readFile(join(directory, "local.json"), "utf8"),
    JSON.stringify(newer, null, 2),
  );
});

test('mode "json" names the file by the ARN without an execution name; other characters become "_"', async (t) => {
  const directory = await tempDir(t);
  const exporter = createFileExporter({ directory, mode: "json" });
  const arn = "arn:aws:lambda:us-east-1:123456789012:function:workflow:$LATEST";
  const noName = makeRecord({ arn });
  assert.equal(noName.executionName, undefined);
  await exporter.export(noName);
  await exporter.export({ ...record, executionName: "../a b.c_d-e" });
  assert.deepEqual((await readdir(directory)).sort(), [
    ".._a_b.c_d-e.json",
    "arn_aws_lambda_us-east-1_123456789012_function_workflow__LATEST.json",
  ]);
});

test('operationsFormat "by-name" and "both" set the written JSON in both modes', async (t) => {
  for (const format of ["by-name", "both"]) {
    const directory = await tempDir(t);
    const expected = applyOperationsFormat(record, format);
    await createFileExporter({ directory, operationsFormat: format }).export(
      record,
    );
    await createFileExporter({
      directory,
      mode: "json",
      operationsFormat: format,
    }).export(record);
    assert.equal(
      await readFile(join(directory, "2026-01-01.ndjson"), "utf8"),
      `${JSON.stringify(expected)}\n`,
    );
    assert.equal(
      await readFile(join(directory, "local.json"), "utf8"),
      JSON.stringify(expected, null, 2),
    );
  }
});

test("each export creates the directory again if it was removed", async (t) => {
  const directory = await tempDir(t);
  const exporter = createFileExporter({ directory });
  await exporter.export(record);
  await rm(directory, { recursive: true });
  await exporter.export(record);
  assert.equal(
    await readFile(join(directory, "2026-01-01.ndjson"), "utf8"),
    `${JSON.stringify(record)}\n`,
  );
});

test("a write error rejects the export", async (t) => {
  const directory = await tempDir(t);
  const exporter = createFileExporter({ directory, mode: "json" });
  // A directory with the file's name makes writeFile fail with EISDIR.
  await createFileExporter({
    directory: join(directory, "local.json"),
  }).export(record);
  await assert.rejects(exporter.export(record), { code: "EISDIR" });
});

test("maxRecordBytes can be set", () => {
  assert.equal(
    createFileExporter({ directory: "/tmp/x", maxRecordBytes: 1 })
      .maxRecordBytes,
    1,
  );
});
