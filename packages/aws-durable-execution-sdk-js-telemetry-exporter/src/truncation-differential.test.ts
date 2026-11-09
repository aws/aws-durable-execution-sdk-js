import { describe, it, expect } from "vitest";
import {
  truncateRecord,
  truncateRecordWithOperationsFormat,
} from "./truncation";
import { applyOperationsFormat } from "./operations-index";
import {
  getTruncationFormat,
  type TruncationFormat,
} from "./truncation-internal";
import { OTelExporter } from "./exporters/otel-exporter";
import type {
  DurableExecutionTelemetryRecord,
  ErrorRecord,
  OperationRecord,
  OperationsFormat,
} from "./types";

// The incremental size tracker must make exactly the same drops as a full
// render after every removal (the reference path `truncateRecord(r, max, render)`
// has no tracker). Names repeat and include prototype keys, and some errors and
// results are removed by the earlier phases, so removals are not monotonic.

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES: (string | undefined)[] = [
  "charge",
  "tax",
  "__proto__",
  "constructor",
  "toString",
  "",
  undefined,
];
const TYPES: OperationRecord["type"][] = ["STEP", "WAIT", "CALLBACK"];
const STATUSES: string[] = ["SUCCEEDED", "FAILED", "STARTED"];

function randomRecord(
  rnd: () => number,
  seed: number,
): DurableExecutionTelemetryRecord {
  const pick = <T>(values: readonly T[]): T =>
    values[Math.floor(rnd() * values.length)];
  const text = (max: number) => "x".repeat(Math.floor(rnd() * max));
  const error = (depth: number): ErrorRecord => {
    const e: ErrorRecord = {
      name: pick(["Error", "TypeError"]),
      message: text(120),
    };
    if (depth < 2 && rnd() < 0.4) e.cause = error(depth + 1);
    return e;
  };

  const operations: OperationRecord[] = [];
  const count = Math.floor(rnd() * 30);
  for (let i = 0; i < count; i++) {
    const name = pick(NAMES);
    const operation = {
      id: `op-${seed}-${i}`,
      type: pick(TYPES),
      status: pick(STATUSES),
      startTime:
        rnd() < 0.85
          ? new Date(
              Date.UTC(2026, 0, 1) + Math.floor(rnd() * 1e6) * 1000,
            ).toISOString()
          : undefined,
    } as OperationRecord;
    if (name !== undefined) operation.name = name;
    if (rnd() < 0.5) {
      operation.result = pick(["", "r", text(300), 42, { k: text(50) }, null]);
    }
    if (rnd() < 0.3) operation.error = error(0);
    if (rnd() < 0.4) operation.durationMs = Math.floor(rnd() * 5000);
    if (rnd() < 0.4) operation.attempt = Math.floor(rnd() * 5);
    if (rnd() < 0.2) operation.subType = pick(["Map", "Child"]);
    operations.push(operation);
  }

  const record = {
    recordType: "DurableExecutionTelemetry",
    schemaVersion: "1.0",
    emittedAt: "2026-07-02T00:00:00.000Z",
    executionArn:
      "arn:aws:lambda:us-east-1:123:function:fn:1/durable-execution/e/i",
    functionName: "fn",
    functionQualifier: "1",
    region: "us-east-1",
    accountId: "123",
    status: "FAILED",
    startTime: "2026-07-02T00:00:00.000Z",
    operations,
  } as DurableExecutionTelemetryRecord;
  if (rnd() < 0.5) record.error = error(0);
  if (rnd() < 0.3) record.input = text(400);
  if (rnd() < 0.3) record.output = text(400);
  return record;
}

const encoder = new TextEncoder();
const bytes = (value: unknown): number =>
  encoder.encode(JSON.stringify(value)).length;

interface Case {
  label: string;
  render: (record: DurableExecutionTelemetryRecord) => unknown;
  format: TruncationFormat;
}

function cases(): Case[] {
  const built: Case[] = [];
  for (const operations of ["array", "by-name", "both"] as OperationsFormat[]) {
    built.push({
      label: operations,
      render: (record) => applyOperationsFormat(record, operations),
      format: { operations },
    });
  }
  for (const operations of ["array", "by-name", "both"] as OperationsFormat[]) {
    const exporter = new OTelExporter({
      endpoint: "https://otel.example/v1/logs",
      operationsFormat: operations,
    });
    const format = getTruncationFormat(exporter);
    expect(format).toBeDefined();
    built.push({
      label: `otel-${operations}`,
      render: (record) => exporter.render(record),
      format: format!,
    });
  }
  return built;
}

describe("truncateRecordWithOperationsFormat matches the full-render reference", () => {
  it("makes the same drops as a full render after every removal", () => {
    const mismatches: string[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const record = randomRecord(prng(seed), seed);
      for (const { label, render, format } of cases()) {
        const fullSize = bytes(render(record));
        for (const fraction of [0.05, 0.3, 0.6, 0.9]) {
          const limit = Math.max(1, Math.floor(fullSize * fraction));
          const fast = truncateRecordWithOperationsFormat(
            record,
            limit,
            render,
            format,
          );
          const reference = truncateRecord(record, limit, render);
          if (JSON.stringify(fast) !== JSON.stringify(reference)) {
            mismatches.push(`seed=${seed} format=${label} limit=${limit}`);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  }, 60_000);
});
