import { Request, Response, NextFunction } from "express";
import { Logger, defaultLogger } from "../../logger";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      logger: Logger;
    }
  }
}

export interface RequestLoggerOptions {
  /**
   * Custom logger instance to use
   * @default defaultLogger
   */
  logger?: Logger;
}

/**
 * Creates an Express middleware that logs requests and responses
 * @param options - Configuration options for the request logger
 * @returns Express middleware function
 */
export function createRequestLogger(options: RequestLoggerOptions = {}) {
  const logger = options.logger ?? defaultLogger.child("HTTP");

  return function requestLogger(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    req.logger = logger;

    // Capture request start time
    const startTime = Date.now();

    // Get client IP - try various headers for proxied requests
    const forwardedFor = Array.isArray(req.headers["x-forwarded-for"])
      ? req.headers["x-forwarded-for"][0]
      : req.headers["x-forwarded-for"];
    const clientIp =
      (forwardedFor ? forwardedFor.split(",")[0].trim() : null) ??
      req.socket.remoteAddress ??
      "-";

    // Log when response is finished
    res.on("finish", () => {
      const responseTime = Date.now() - startTime;
      const url = req.originalUrl || req.url || "-";
      const method = req.method || "-";
      const status = res.statusCode;
      const userAgent = req.headers["user-agent"] ?? "-";
      const referer = req.headers.referer ?? "-";

      // Format: ip - "method url" status "referer" "user-agent" responseTime
      const logMessage = `${clientIp} - "${method} ${url}" ${status} "${referer}" "${userAgent}" ${responseTime}ms`;

      // Determine log level based on status code
      if (status >= 500) {
        logger.error(logMessage);
      } else if (status >= 400) {
        logger.warn(logMessage);
      } else {
        logger.debug(logMessage);
      }
    });

    next();
  };
}
