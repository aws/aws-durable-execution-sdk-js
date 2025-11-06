import { Request, Response } from "express";
import { createRequestLogger } from "../request-logger";
import { Logger } from "../../../logger";
import { Socket } from "net";

describe("Request Logger Middleware", () => {
  // Mock Express objects
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: jest.Mock;
  let mockLogger: Logger;
  let finishCallback: (() => void) | null = null;

  beforeEach(() => {
    // Mock Date.now to return consistent values for testing
    jest.spyOn(Date, "now").mockImplementation(() => 1625097600000); // Fixed timestamp

    // Setup request mock
    req = {
      method: "GET",
      url: "/api/test",
      originalUrl: "/api/test",
      headers: {
        "user-agent": "test-agent",
        referer: "https://example.com",
      },
      query: { param: "value" },
      socket: {
        remoteAddress: "127.0.0.1",
      } as Socket,
    };

    // Setup response mock
    res = {
      statusCode: 200,
      on: jest.fn((event, callback) => {
        if (event === "finish") {
          finishCallback = callback;
        }
        return res as Response;
      }),
    };

    // Mock next function
    next = jest.fn();

    const tempLogger = new Logger();

    // Mock logger functions
    mockLogger = tempLogger;

    mockLogger.info = jest.fn();
    mockLogger.warn = jest.fn();
    mockLogger.error = jest.fn();
    mockLogger.debug = jest.fn();
    mockLogger.child = jest.fn().mockReturnValue(new Logger());

    // Reset finishCallback for each test
    finishCallback = null;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should create middleware with default logger", () => {
    const middleware = createRequestLogger();
    expect(middleware).toBeInstanceOf(Function);
  });

  it("should create middleware with custom logger", () => {
    const customLogger = new Logger();
    const middleware = createRequestLogger({ logger: customLogger });
    expect(middleware).toBeInstanceOf(Function);
  });

  it("should call next function", () => {
    const middleware = createRequestLogger({ logger: mockLogger });
    middleware(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it("should create logger on request object", () => {
    expect(req.logger).toBeUndefined();
    const middleware = createRequestLogger({ logger: mockLogger });
    middleware(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
    expect(req.logger).toBe(mockLogger);
  });

  it("should log successful request with debug level", () => {
    // Advance mock time to simulate request duration
    jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(1625097600000) // Start time
      .mockReturnValueOnce(1625097600100); // End time (100ms later)

    const middleware = createRequestLogger({ logger: mockLogger });
    middleware(req as Request, res as Response, next);

    // Simulate response finished event
    expect(finishCallback).not.toBeNull();
    if (finishCallback) finishCallback();

    // Verify log was called with correct message
    expect(mockLogger.debug).toHaveBeenCalledWith(
      '127.0.0.1 - "GET /api/test" 200 "https://example.com" "test-agent" 100ms',
    );
  });

  it("should log client warning for 4xx status codes", () => {
    res.statusCode = 404;

    const middleware = createRequestLogger({ logger: mockLogger });
    middleware(req as Request, res as Response, next);

    // Simulate response finished event
    if (finishCallback) finishCallback();

    // Verify warning was logged
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("404"),
    );
    expect(mockLogger.info).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("should log server error for 5xx status codes", () => {
    res.statusCode = 500;

    const middleware = createRequestLogger({ logger: mockLogger });
    middleware(req as Request, res as Response, next);

    // Simulate response finished event
    finishCallback?.();

    // Verify error was logged
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("500"),
    );
    expect(mockLogger.info).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("should use x-forwarded-for header when available", () => {
    req.headers = {
      ...req.headers,
      "x-forwarded-for": "192.168.1.1, 10.0.0.1",
    };

    const middleware = createRequestLogger({ logger: mockLogger });
    middleware(req as Request, res as Response, next);

    // Simulate response finished event
    finishCallback?.();

    // Verify the first forwarded IP was used
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("192.168.1.1 -"),
    );
  });

  it("should handle x-forwarded-for as array", () => {
    req.headers = {
      ...req.headers,
      "x-forwarded-for": ["192.168.1.1, 10.0.0.1"],
    };

    const middleware = createRequestLogger({ logger: mockLogger });
    middleware(req as Request, res as Response, next);

    // Simulate response finished event
    finishCallback?.();

    // Verify the first forwarded IP was used
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("192.168.1.1 -"),
    );
  });

  it("should handle missing request fields gracefully", () => {
    req = {
      headers: {},
      socket: {} as Socket,
    };

    const middleware = createRequestLogger({
      logger: mockLogger,
    });
    middleware(req as Request, res as Response, next);

    // Simulate response finished event
    finishCallback?.();

    // Verify log shows default values for missing fields
    expect(mockLogger.debug).toHaveBeenCalledWith('- - "- -" 200 "-" "-" 0ms');
  });
});
