import { describe, it, expect } from "vitest";
import { truncateRecord } from "./truncation";
import {
  applyOperationsFormat,
  withOperationsByName,
} from "./operations-index";
import type {
  OperationRecord,
  OperationResult,
  DurableExecutionTelemetryRecord,
} from "./types";

function op(
  partial: Partial<OperationRecord> & { id: string },
): OperationRecord {
  return {
    type: "STEP",
    status: "SUCCEEDED",
    ...partial,
  } as OperationRecord;
}

function record(
  partial: Partial<DurableExecutionTelemetryRecord> = {},
): DurableExecutionTelemetryRecord {
  return {
    recordType: "DurableExecutionTelemetry",
    schemaVersion: "1.0",
    emittedAt: "2026-07-02T00:00:00.000Z",
    executionArn:
      "arn:aws:lambda:us-east-1:123:function:fn:1/durable-execution/e/i",
    functionName: "fn",
    functionQualifier: "1",
    region: "us-east-1",
    accountId: "123",
    status: "SUCCEEDED",
    startTime: "2026-07-02T00:00:00.000Z",
    operations: [],
    ...partial,
  };
}

const bytes = (r: unknown): number =>
  new TextEncoder().encode(JSON.stringify(r)).length;

describe("truncateRecord", () => {
  it("returns the original record unchanged when it fits", () => {
    const r = record({ operations: [op({ id: "o1", name: "a" })] });
    const out = truncateRecord(r, 10_000);
    expect(out).toBe(r); // same reference — no copy
    expect(out.truncated).toBeUndefined();
  });

  it("returns the original when no limit is set", () => {
    const r = record({
      operations: [op({ id: "o1", name: "a", result: "x".repeat(1000) })],
    });
    expect(truncateRecord(r, undefined)).toBe(r);
    expect(truncateRecord(r, 0)).toBe(r);
  });

  it("drops operation results oldest-first until it fits, marking truncated", () => {
    const ops = [
      op({
        id: "o1",
        name: "old",
        startTime: "2026-07-02T00:00:01.000Z",
        result: "A".repeat(500),
      }),
      op({
        id: "o2",
        name: "new",
        startTime: "2026-07-02T00:00:02.000Z",
        result: "B".repeat(500),
      }),
    ];
    const r = record({ operations: ops });
    const full = bytes(r);
    // Limit that forces dropping exactly one result (the oldest).
    const limit = full - 400;

    const out = truncateRecord(r, limit);

    expect(out).not.toBe(r);
    expect(out.truncated).toBe(true);
    expect(out.droppedOperations).toBeUndefined();
    // Oldest (o1) lost its result and is marked truncated; newest (o2) kept it.
    // Both operations remain in the array.
    expect(out.operations).toHaveLength(2);
    const o1 = out.operations.find((o) => o.id === "o1");
    const o2 = out.operations.find((o) => o.id === "o2");
    expect(o1?.result).toBeUndefined();
    expect(o1?.truncated).toBe(true);
    expect(o2?.result).toBe("B".repeat(500));
    expect(o2?.truncated).toBeUndefined();
    expect(bytes(out)).toBeLessThanOrEqual(limit);
  });

  it("drops whole operations oldest-first after results are exhausted", () => {
    const ops = Array.from({ length: 5 }, (_, i) =>
      op({
        id: `o${i}`,
        name: `step-${i}`,
        startTime: `2026-07-02T00:00:0${i}.000Z`,
      }),
    );
    const r = record({ operations: ops });
    // Tight limit that no result-dropping can satisfy (there are no results),
    // forcing whole-operation drops.
    const limit = bytes(record({ operations: ops.slice(0, 2) })) + 20;

    const out = truncateRecord(r, limit);

    expect(out.truncated).toBe(true);
    expect(out.droppedOperations).toBeGreaterThan(0);
    // The survivors must be the newest ones (oldest dropped first).
    const survivingIds = out.operations.map((o) => o.id);
    expect(survivingIds).not.toContain("o0");
    expect(bytes(out)).toBeLessThanOrEqual(limit);
  });

  it("does not mutate the input record (shared across exporters)", () => {
    const ops = [op({ id: "o1", name: "a", result: "X".repeat(1000) })];
    const r = record({ operations: ops });
    const before = JSON.stringify(r);

    truncateRecord(r, bytes(r) - 500);

    expect(JSON.stringify(r)).toBe(before);
    expect(r.operations[0].result).toBe("X".repeat(1000));
    expect(r.truncated).toBeUndefined();
  });

  it("leaves input/output untouched and returns original if nothing can be dropped", () => {
    // No operations, tiny input/output — already fits, nothing to drop.
    const r = record({ input: { a: 1 }, output: { b: 2 }, operations: [] });
    const out = truncateRecord(r, 10_000);
    expect(out).toBe(r);
    expect(out.truncated).toBeUndefined();
  });

  it("drops execution input then output as a last resort", () => {
    // No operations to shed; a huge input keeps the record over the limit, so
    // the limiter must fall through to dropping input (then output).
    const r = record({
      input: { blob: "Z".repeat(5000) },
      output: { blob: "Y".repeat(50) },
      operations: [],
    });
    // Big enough to hold the record minus the (huge) input, plus marker overhead.
    const limit =
      bytes(record({ output: { blob: "Y".repeat(50) }, operations: [] })) + 80;
    const out = truncateRecord(r, limit);

    expect(out).not.toBe(r);
    expect(out.truncated).toBe(true);
    expect(out.droppedInput).toBe(true);
    expect(out.input).toBeUndefined();
    // Input alone was enough to get under the limit → output is preserved
    // (input is dropped before output).
    expect(out.droppedOutput).toBeUndefined();
    expect(out.output).toEqual({ blob: "Y".repeat(50) });
    // Original is never mutated.
    expect(r.input).toEqual({ blob: "Z".repeat(5000) });
  });

  it("drops output too when dropping input is not enough", () => {
    const r = record({
      input: { blob: "Z".repeat(5000) },
      output: { blob: "Y".repeat(5000) },
      operations: [],
    });
    const out = truncateRecord(r, 300);

    expect(out.truncated).toBe(true);
    expect(out.droppedInput).toBe(true);
    expect(out.droppedOutput).toBe(true);
    expect(out.input).toBeUndefined();
    expect(out.output).toBeUndefined();
  });

  it("drops operations before touching input/output", () => {
    // A big operation result plus a modest input: dropping the operation should
    // suffice, leaving input intact.
    const r = record({
      input: { keep: "me" },
      operations: [
        op({
          id: "o1",
          name: "big",
          startTime: "2026-07-02T00:00:01.000Z",
          result: "R".repeat(3000),
        }),
      ],
    });
    const limit = bytes(record({ input: { keep: "me" }, operations: [] })) + 80;

    const out = truncateRecord(r, limit);

    expect(out.truncated).toBe(true);
    expect(out.input).toEqual({ keep: "me" });
    expect(out.droppedInput).toBeUndefined();
    expect(out.droppedOutput).toBeUndefined();
  });

  it("treats operations without a startTime as newest (dropped last)", () => {
    const ops = [
      op({ id: "timed", name: "timed", startTime: "2026-07-02T00:00:01.000Z" }),
      op({ id: "untimed", name: "untimed" }), // no startTime
    ];
    const r = record({ operations: ops });
    // Force dropping exactly one whole operation.
    const limit = bytes(record({ operations: [ops[0]] })) + 5;

    const out = truncateRecord(r, limit);

    expect(out.droppedOperations).toBe(1);
    // The timed (older) op is dropped; the untimed one survives.
    expect(out.operations.map((o) => o.id)).toEqual(["untimed"]);
  });
});

describe("truncateRecord render-aware sizing", () => {
  // A render that emits a strictly larger shape than the canonical record,
  // mirroring exporters that expand operations (e.g. operationsByName / "both").
  const expand = (r: DurableExecutionTelemetryRecord): unknown => ({
    ...r,
    operationsExpanded: r.operations,
  });

  it("measures the rendered shape, not the canonical record", () => {
    const r = record({
      operations: [
        op({ id: "o1", name: "a", result: "A".repeat(400) }),
        op({ id: "o2", name: "b", result: "B".repeat(400) }),
      ],
    });
    // Limit sits between the plain record and its (larger) rendered shape.
    const limit = bytes(r) + 50;
    expect(bytes(r)).toBeLessThanOrEqual(limit); // plain record already fits...
    expect(bytes(expand(r))).toBeGreaterThan(limit); // ...but the emitted shape doesn't.

    // Without a render, truncateRecord sees a fitting record → no-op.
    expect(truncateRecord(r, limit)).toBe(r);

    // With the render, it trims until the *emitted* shape fits.
    const out = truncateRecord(r, limit, expand);
    expect(out).not.toBe(r);
    expect(out.truncated).toBe(true);
    expect(bytes(expand(out))).toBeLessThanOrEqual(limit);
  });

  it("still returns the original when the rendered shape already fits", () => {
    const r = record({ operations: [op({ id: "o1", name: "a" })] });
    const out = truncateRecord(r, 10_000, expand);
    expect(out).toBe(r);
    expect(out.truncated).toBeUndefined();
  });

  it("does not throw when render is explicitly undefined (falls back to identity)", () => {
    // Mirrors the scheduler's `exporter.render?.bind(exporter)`, which evaluates
    // to `undefined` for exporters without a `render`. The default parameter
    // applies to an explicit `undefined` argument, so this must behave exactly
    // like omitting the argument, not throw.
    const ops = [
      op({ id: "o1", name: "a", result: "A".repeat(500) }),
      op({ id: "o2", name: "b", result: "B".repeat(500) }),
    ];
    const r = record({ operations: ops });
    const limit = bytes(r) - 400;

    expect(() => truncateRecord(r, limit, undefined)).not.toThrow();
    expect(truncateRecord(r, limit, undefined)).toEqual(
      truncateRecord(r, limit),
    );
  });
});

describe("truncateRecord search over the drop count", () => {
  // A seeded generator, so a failure reproduces.
  let seed = 1;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = <T>(items: T[]): T => items[Math.floor(rnd() * items.length)];
  const pieces = ["x", '"', "\\", "\n", "é", "中文", "😀", "\u2028", "  "];
  const text = (max: number): string =>
    Array.from({ length: Math.floor(rnd() * max) }, () => pick(pieces)).join(
      "",
    );
  const names = ["a", "b", "a", "", "名前", 'q"uote', "back\\slash"];
  // Short results are common in real records. Clearing one of them makes the
  // record bigger, so they test the rule that such results are never cleared.
  const smallResults: OperationResult[] = [
    true,
    false,
    0,
    7,
    null,
    "",
    "ok",
    "id-123",
  ];
  const randomResult = (): OperationResult | undefined => {
    const x = rnd();
    if (x < 0.25) return text(60);
    if (x < 0.5) return pick(smallResults);
    return undefined;
  };
  // A result is cleared only when its JSON is longer than 7 bytes.
  const clearable = (result: unknown): boolean =>
    result !== undefined && bytes(result) > 7;

  // Operations are in start-time order, so position i is rank i.
  function randomRecord(n: number): DurableExecutionTelemetryRecord {
    const ops = Array.from({ length: n }, (_, i) =>
      op({
        id: `o${i}`,
        name: rnd() < 0.9 ? pick(names) : undefined,
        status: pick(["SUCCEEDED", "FAILED"]),
        startTime: new Date(Date.UTC(2026, 6, 2) + i * 1000).toISOString(),
        result: randomResult(),
        error:
          rnd() < 0.3
            ? {
                name: "Err",
                message: text(40),
                cause:
                  rnd() < 0.5 ? { name: "C", message: text(40) } : undefined,
              }
            : undefined,
      }),
    );
    return record({
      operations: ops,
      input: rnd() < 0.5 ? { v: text(200) } : undefined,
      output: rnd() < 0.5 ? { v: text(200) } : undefined,
    });
  }

  const lastTruncated = (ops: OperationRecord[]): number =>
    ops.map((o) => o.truncated === true).lastIndexOf(true);

  const renders: [string, (r: DurableExecutionTelemetryRecord) => unknown][] = [
    ["array", (r) => r],
    ["by-name", withOperationsByName],
    ["both", (r) => applyOperationsFormat(r, "both")],
  ];

  it.each(renders)(
    "never goes over the limit and drops oldest first (%s)",
    (_, render) => {
      for (let c = 0; c < 200; c++) {
        const r = randomRecord(1 + Math.floor(rnd() * 30));
        const limit = Math.floor(bytes(render(r)) * (0.1 + rnd()));
        const out = truncateRecord(r, limit, render);
        const allGone =
          out.operations.length === 0 &&
          (r.input === undefined || out.droppedInput === true) &&
          (r.output === undefined || out.droppedOutput === true);
        if (!allGone) expect(bytes(render(out))).toBeLessThanOrEqual(limit);
        // The kept operations are the newest ones, in their original order.
        const cut = out.droppedOperations ?? 0;
        expect(out.operations.map((o) => o.id)).toEqual(
          r.operations.slice(cut).map((o) => o.id),
        );
        // Results are cut from the oldest kept operations only, and only
        // when they are longer than 7 bytes.
        const lastCut = lastTruncated(out.operations);
        for (const [i, o] of out.operations.entries()) {
          const orig = r.operations[cut + i];
          const isCut = i <= lastCut && clearable(orig.result);
          expect(o.result).toEqual(isCut ? undefined : orig.result);
          expect(o.truncated).toBe(isCut ? true : undefined);
        }
      }
    },
  );

  it("drops the fewest operations when each drop shrinks the record", () => {
    // In the array format, cutting a result longer than 7 bytes or a whole
    // operation always shrinks the record. So one fewer drop must not fit.
    // This is the result of a check after each single drop.
    for (let c = 0; c < 200; c++) {
      const n = 1 + Math.floor(rnd() * 30);
      const r = record({
        operations: Array.from({ length: n }, (_, i) =>
          op({
            id: `o${i}`,
            name: pick(names),
            startTime: new Date(Date.UTC(2026, 6, 2) + i * 1000).toISOString(),
            result: randomResult(),
          }),
        ),
      });
      const floor = bytes(record()) + 100;
      const limit = floor + Math.floor((bytes(r) - floor) * rnd());
      const out = truncateRecord(r, limit);
      expect(bytes(out)).toBeLessThanOrEqual(limit);
      const cut = out.droppedOperations ?? 0;
      const ops = out.operations.slice();
      if (cut > 0) {
        // Put back the newest cut operation (its result is cut too).
        const back = r.operations[cut - 1];
        ops.unshift(
          !clearable(back.result)
            ? back
            : { ...back, result: undefined, truncated: true },
        );
      } else {
        // Put back the newest cut result.
        const i = lastTruncated(ops);
        if (i < 0) continue;
        ops[i] = r.operations[i];
      }
      const oneFewer = {
        ...out,
        operations: ops,
        droppedOperations: cut > 1 ? cut - 1 : undefined,
        truncated: ops.some((o) => o.truncated) || cut > 1 ? true : undefined,
      };
      expect(bytes(oneFewer)).toBeGreaterThan(limit);
    }
  });

  it("renders a few times for a custom render", () => {
    // A render the package does not know: the record as a JSON string body.
    let count = 0;
    const render = (r: DurableExecutionTelemetryRecord): unknown => {
      count++;
      return { body: JSON.stringify(withOperationsByName(r)) };
    };
    const r = record({
      operations: Array.from({ length: 2_000 }, (_, i) =>
        op({
          id: `o${i}`,
          name: `step-${i}`,
          subType: "Step",
          startTime: new Date(Date.UTC(2026, 6, 2) + i).toISOString(),
          endTime: new Date(Date.UTC(2026, 6, 2) + i + 3).toISOString(),
          durationMs: 3,
          attempt: 1,
        }),
      ),
    });
    const out = truncateRecord(r, 256_000, render);
    expect(out.droppedOperations).toBeGreaterThan(0);
    expect(bytes(render(out))).toBeLessThanOrEqual(256_000);
    expect(count).toBeLessThan(40);
  });
});

describe("truncateRecord edge cases of the drop-count search", () => {
  const t0 = Date.UTC(2026, 6, 2);
  const at = (s: number): string => new Date(t0 + s * 1000).toISOString();
  // The record as JSON, so `undefined` fields compare as absent.
  const json = (r: unknown): unknown => JSON.parse(JSON.stringify(r));
  const cleared = (o: OperationRecord): OperationRecord => ({
    ...o,
    result: undefined,
    truncated: true,
  });

  it("clears one large old result and keeps many small results", () => {
    // Clearing a result of `true`, `1`, `"ok"` or `null` makes the record
    // bigger. So only the large result is cleared, and no operation is dropped.
    // A check after each single drop gives the same result.
    const small = [true, 1, "ok", null];
    const operations = [
      op({ id: "big", startTime: at(0), result: "x".repeat(5_000) }),
      ...Array.from({ length: 1_999 }, (_, i) =>
        op({ id: `o${i}`, startTime: at(i + 1), result: small[i % 4] }),
      ),
    ];
    const r = record({ operations });
    const limit = bytes(r) - 4_000;
    const out = truncateRecord(r, limit);
    expect(json(out)).toEqual(
      json({
        ...r,
        operations: [cleared(operations[0]), ...operations.slice(1)],
        truncated: true,
      }),
    );
    expect(bytes(out)).toBeLessThanOrEqual(limit);
  });

  it("clears every large result without dropping an operation", () => {
    // Only clearing every result longer than 7 bytes makes the record fit.
    const operations = [
      op({ id: "o0", startTime: at(0), result: "a".repeat(100) }),
      op({ id: "o1", startTime: at(1), result: true }),
      op({ id: "o2", startTime: at(2), result: "b".repeat(100) }),
      op({ id: "o3", startTime: at(3), result: { k: "c".repeat(100) } }),
    ];
    const r = record({ operations });
    const expected = {
      ...r,
      operations: [
        cleared(operations[0]),
        operations[1],
        cleared(operations[2]),
        cleared(operations[3]),
      ],
      truncated: true,
    };
    const out = truncateRecord(r, bytes(expected));
    expect(json(out)).toEqual(json(expected));
  });

  it("drops every operation and keeps the input", () => {
    // Only dropping every operation makes the record fit. So the input stays.
    const operations = Array.from({ length: 5 }, (_, i) =>
      op({ id: `o${i}`, startTime: at(i), result: "r".repeat(50) }),
    );
    const r = record({ operations, input: { v: "i".repeat(100) } });
    const expected = {
      ...r,
      operations: [],
      truncated: true,
      droppedOperations: 5,
    };
    const out = truncateRecord(r, bytes(expected));
    expect(json(out)).toEqual(json(expected));
    expect(out.droppedInput).toBeUndefined();
  });

  it("clears no result when dropping the causes is enough", () => {
    const error = {
      name: "Err",
      message: "m",
      cause: { name: "C", message: "c".repeat(200) },
    };
    const operations = [
      op({ id: "o0", startTime: at(0), result: "a".repeat(100), error }),
      op({ id: "o1", startTime: at(1), result: "b".repeat(100) }),
    ];
    const r = record({ operations });
    const expected = {
      ...r,
      operations: [
        { ...operations[0], error: { name: "Err", message: "m" } },
        operations[1],
      ],
      truncated: true,
      droppedCauses: true,
    };
    const out = truncateRecord(r, bytes(expected));
    expect(json(out)).toEqual(json(expected));
  });

  it("orders by start time when start times are out of order or missing", () => {
    // The oldest-first order is o2, o3, o0, then o1, which has no start time.
    const operations = [
      op({ id: "o0", startTime: at(3), result: "a".repeat(50) }),
      op({ id: "o1", result: "b".repeat(50) }),
      op({ id: "o2", startTime: at(1), result: "c".repeat(50) }),
      op({ id: "o3", startTime: at(2), result: "d".repeat(50) }),
    ];
    const r = record({ operations });
    const [o0, o1, o2, o3] = operations;

    const twoCleared = {
      ...r,
      operations: [o0, o1, cleared(o2), cleared(o3)],
      truncated: true,
    };
    expect(json(truncateRecord(r, bytes(twoCleared)))).toEqual(
      json(twoCleared),
    );

    const twoDropped = {
      ...r,
      operations: [cleared(o0), cleared(o1)],
      truncated: true,
      droppedOperations: 2,
    };
    expect(json(truncateRecord(r, bytes(twoDropped)))).toEqual(
      json(twoDropped),
    );
  });
});
