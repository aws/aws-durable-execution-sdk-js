import type { Tracer } from "@opentelemetry/api";
import type { IdGenerator } from "@opentelemetry/sdk-trace-node";
import { DeterministicIdGenerator } from "../deterministic-id-generator";
import { tryInstallGlobalIdGenerator } from "../global-id-generator";

function fallbackIdGenerator(): IdGenerator {
  return {
    generateTraceId: jest.fn(() => "f".repeat(32)),
    generateSpanId: jest.fn(() => "e".repeat(16)),
  };
}

describe("tryInstallGlobalIdGenerator", () => {
  it("replaces the SDK field and chains to its existing generator", () => {
    const fallback = fallbackIdGenerator();
    const tracer = {
      _idGenerator: fallback,
    } as unknown as Tracer;

    const installed = tryInstallGlobalIdGenerator(tracer);

    expect(installed).toBeInstanceOf(DeterministicIdGenerator);
    expect(
      Reflect.get(tracer, "_idGenerator"),
    ).toBe(installed);
    expect(installed?.generateTraceId()).toBe("f".repeat(32));
    expect(installed?.generateSpanId()).toBe("e".repeat(16));

    installed?.withIds(
      {
        traceId: "a".repeat(32),
        spanId: "1".repeat(16),
      },
      () => {
        expect(installed.generateTraceId()).toBe("a".repeat(32));
        expect(installed.generateSpanId()).toBe("1".repeat(16));
      },
    );
  });

  it("reuses an already installed deterministic generator", () => {
    const idGenerator = new DeterministicIdGenerator();
    const tracer = {
      _idGenerator: idGenerator,
    } as unknown as Tracer;

    expect(tryInstallGlobalIdGenerator(tracer)).toBe(idGenerator);
  });

  it("returns undefined when the field does not exist", () => {
    expect(tryInstallGlobalIdGenerator({} as Tracer)).toBeUndefined();
  });

  it("returns undefined when the field cannot be replaced", () => {
    const fallback = fallbackIdGenerator();
    const tracer = {} as Tracer;
    Object.defineProperty(tracer, "_idGenerator", {
      value: fallback,
      writable: false,
    });

    expect(tryInstallGlobalIdGenerator(tracer)).toBeUndefined();
    expect(Reflect.get(tracer, "_idGenerator")).toBe(fallback);
  });
});
