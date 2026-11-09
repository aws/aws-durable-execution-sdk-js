/**
 * Covers the logger on a runtime whose `node:util` has no `formatWithOptions`.
 *
 * Lightweight JavaScript runtimes targeting Lambda ship a partial `node:util`: LLRT, for
 * example, provides `format` but not `formatWithOptions`. Without the fallback, every
 * multi-argument log record throws `TypeError: not a function` from inside the logger — so the
 * first failure is a logging call, not the missing capability, which is hard to read.
 *
 * `formatWithOptions` is resolved once at module scope, so each test re-imports the module to
 * pick up a different `node:util`.
 */
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";

describe("default logger on a runtime without util.formatWithOptions", () => {
  const mockConsole = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  const loggingContext = {
    durableExecutionArn: "arn:aws:lambda:us-east-1:000000000000:function:f:1",
    requestId: "req-1",
    tenantId: undefined,
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock("node:console", () => ({
      // biome-ignore lint/complexity/useArrowFunction: invoked with `new`, so vitest needs a constructible implementation
      Console: vi.fn().mockImplementation(function () {
        return mockConsole;
      }),
    }));
  });

  afterEach(() => {
    vi.doUnmock("node:console");
    vi.doUnmock("node:util");
    vi.resetModules();
  });

  /** A `node:util` shaped like LLRT's: `format` present, `formatWithOptions` absent. */
  const mockPartialUtil = (): Mock => {
    const format = vi.fn((...args: unknown[]) => args.map(String).join(" "));
    vi.doMock("node:util", () => ({ __esModule: true, default: { format } }));
    return format;
  };

  it("formats multi-argument records through util.format instead of throwing", async () => {
    const format = mockPartialUtil();
    const { createDefaultLogger } = await import("./default-logger");

    const logger = createDefaultLogger(loggingContext);
    expect(() => logger.info("processing", { userId: "u-1" })).not.toThrow();

    expect(format).toHaveBeenCalled();
    const [record] = mockConsole.info.mock.calls[0];
    expect(JSON.parse(record).message).toContain("processing");
  });

  it("still formats when a record cannot be serialized directly", async () => {
    mockPartialUtil();
    const { createDefaultLogger } = await import("./default-logger");

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const logger = createDefaultLogger(loggingContext);
    // A single unserializable parameter takes the JSON.stringify failure path, which is the
    // logger's other formatWithOptions call site.
    expect(() => logger.info(circular)).not.toThrow();
    expect(mockConsole.info).toHaveBeenCalled();
  });

  it("prefers the runtime's formatWithOptions when it exists", async () => {
    const format = vi.fn(() => "unused");
    const formatWithOptions = vi.fn(() => "from formatWithOptions");
    vi.doMock("node:util", () => ({
      __esModule: true,
      default: { format, formatWithOptions },
    }));

    const { createDefaultLogger } = await import("./default-logger");
    createDefaultLogger(loggingContext).info("a", "b");

    expect(formatWithOptions).toHaveBeenCalled();
    expect(format).not.toHaveBeenCalled();
  });
});
