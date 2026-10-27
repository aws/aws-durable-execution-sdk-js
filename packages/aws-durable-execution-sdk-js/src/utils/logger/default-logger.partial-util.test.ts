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

describe("default logger on a runtime without util.formatWithOptions", () => {
  const mockConsole = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  const loggingContext = {
    durableExecutionArn: "arn:aws:lambda:us-east-1:000000000000:function:f:1",
    requestId: "req-1",
    tenantId: undefined,
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.doMock("node:console", () => ({
      Console: jest.fn().mockImplementation(() => mockConsole),
    }));
  });

  afterEach(() => {
    jest.dontMock("node:console");
    jest.dontMock("node:util");
    jest.resetModules();
  });

  /** A `node:util` shaped like LLRT's: `format` present, `formatWithOptions` absent. */
  const mockPartialUtil = (): jest.Mock => {
    const format = jest.fn((...args: unknown[]) => args.map(String).join(" "));
    jest.doMock("node:util", () => ({ __esModule: true, default: { format } }));
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
    const format = jest.fn(() => "unused");
    const formatWithOptions = jest.fn(() => "from formatWithOptions");
    jest.doMock("node:util", () => ({
      __esModule: true,
      default: { format, formatWithOptions },
    }));

    const { createDefaultLogger } = await import("./default-logger");
    createDefaultLogger(loggingContext).info("a", "b");

    expect(formatWithOptions).toHaveBeenCalled();
    expect(format).not.toHaveBeenCalled();
  });
});
