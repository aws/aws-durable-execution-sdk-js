import { Request, Response } from "express";
import { handleCheckpointServerError } from "../handle-checkpoint-server-error";
import { Logger } from "../../../logger";

describe("Handle Checkpoint Server Error Middleware", () => {
  // Mock Express objects
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: jest.Mock;
  let mockLogger: Logger;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    // Setup request mock with logger
    mockLogger = new Logger();
    mockLogger.error = jest.fn();

    req = {
      logger: mockLogger as unknown as Logger,
    };

    // Setup response mock with chained methods
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    res = {
      status: statusMock,
      json: jsonMock,
    };

    // Mock next function
    next = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should log the error", () => {
    const error = new Error("Test error");
    void handleCheckpointServerError(
      error,
      req as Request,
      res as Response,
      next,
    );

    expect(mockLogger.error).toHaveBeenCalledWith(
      "Checkpoint server error:",
      error,
    );
  });

  it("should set status code to 500", () => {
    void handleCheckpointServerError(
      new Error("Test error"),
      req as Request,
      res as Response,
      next,
    );

    expect(statusMock).toHaveBeenCalledWith(500);
  });

  it("should return error message when error is an Error object", () => {
    const errorMessage = "Test error message";
    const error = new Error(errorMessage);

    void handleCheckpointServerError(
      error,
      req as Request,
      res as Response,
      next,
    );

    expect(jsonMock).toHaveBeenCalledWith({
      message: errorMessage,
    });
  });

  it("should return error message when error is an object with message property", () => {
    const errorMessage = "Custom error message";
    const error = { message: errorMessage };

    void handleCheckpointServerError(
      error,
      req as Request,
      res as Response,
      next,
    );

    expect(jsonMock).toHaveBeenCalledWith({
      message: errorMessage,
    });
  });

  it("should return 'Unexpected error' for string errors", () => {
    const error = "String error";

    void handleCheckpointServerError(
      error,
      req as Request,
      res as Response,
      next,
    );

    expect(jsonMock).toHaveBeenCalledWith({
      message: "Unexpected error",
    });
  });

  it("should return 'Unexpected error' for null", () => {
    void handleCheckpointServerError(
      null,
      req as Request,
      res as Response,
      next,
    );

    expect(jsonMock).toHaveBeenCalledWith({
      message: "Unexpected error",
    });
  });

  it("should return 'Unexpected error' for undefined", () => {
    void handleCheckpointServerError(
      undefined,
      req as Request,
      res as Response,
      next,
    );

    expect(jsonMock).toHaveBeenCalledWith({
      message: "Unexpected error",
    });
  });

  it("should return 'Unexpected error' for error objects without message property", () => {
    const error = { code: 123 };

    void handleCheckpointServerError(
      error,
      req as Request,
      res as Response,
      next,
    );

    expect(jsonMock).toHaveBeenCalledWith({
      message: "Unexpected error",
    });
  });
});
