import {
  DurableLogger,
  DurableLoggingContext,
} from "../../types/durable-logger";
import { DurableLogData } from "../../types/logger";

/**
 * The methods of a Powertools for AWS Lambda (TypeScript) `Logger` that the
 * adapter calls.
 *
 * The adapter describes the logger by these method signatures. It does not
 * import `@aws-lambda-powertools/logger`. So the SDK has no dependency on
 * Powertools. A Powertools `Logger` instance satisfies this interface.
 *
 * @public
 */
export interface PowertoolsLoggerLike {
  info(input: unknown, ...extraInput: unknown[]): void;
  warn(input: unknown, ...extraInput: unknown[]): void;
  error(input: unknown, ...extraInput: unknown[]): void;
  debug(input: unknown, ...extraInput: unknown[]): void;
}

type LogMethod = "info" | "warn" | "error" | "debug";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Returns `data` without the keys that `input` has as own enumerable keys.
 * A non-object `input`, such as a string, has no keys to omit.
 */
function omitKeysOf(
  data: Record<string, unknown>,
  input: unknown,
): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    return data;
  }
  const inputKeys = new Set(Object.keys(input));
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !inputKeys.has(key)),
  );
}

/**
 * A {@link DurableLogger} that writes through a Powertools `Logger` and adds
 * the durable execution metadata to every log entry.
 *
 * Create it with {@link createPowertoolsLogger}.
 *
 * @public
 */
export class PowertoolsDurableLogger<
  Logger extends PowertoolsLoggerLike = PowertoolsLoggerLike,
> implements DurableLogger
{
  private durableLoggingContext: DurableLoggingContext | undefined;

  /**
   * @param powertoolsLogger - The Powertools `Logger` that writes the log entries
   */
  constructor(readonly powertoolsLogger: Logger) {}

  /**
   * The SDK calls this method for every durable context. The context it passes
   * resolves the metadata for the operation that is running at the time of each
   * log call. So one adapter instance logs the correct `operationId` and
   * `attempt` for concurrent steps and child contexts.
   */
  configureDurableLoggingContext(
    durableLoggingContext: DurableLoggingContext,
  ): void {
    this.durableLoggingContext = durableLoggingContext;
  }

  info(...params: Parameters<Logger["info"]>): void {
    this.write("info", params);
  }

  warn(...params: Parameters<Logger["warn"]>): void {
    this.write("warn", params);
  }

  error(...params: Parameters<Logger["error"]>): void {
    this.write("error", params);
  }

  debug(...params: Parameters<Logger["debug"]>): void {
    this.write("debug", params);
  }

  /**
   * Powertools builds a log entry in this order:
   *
   * 1. It adds the keys of the first argument, when that argument is an object.
   * 2. It adds the keys of each later object argument, in argument order.
   * 3. A key added later replaces a key added earlier.
   *
   * The caller's keys must replace the durable metadata keys, as they do in the
   * Python SDK. So for a plain-object input, the metadata goes before the
   * caller's keys in that same object. For any other input, the metadata goes
   * in a new object that is the first extra argument, before the caller's extra
   * arguments.
   *
   * An `Error` keeps `message` and `stack` in non-enumerable properties. Object
   * spread copies only enumerable properties. So the adapter does not spread an
   * `Error` or any other non-plain object. It passes the input unchanged.
   *
   * Powertools adds the own enumerable keys of a non-plain object input in
   * step 1. The metadata object comes later, in step 2, so its keys would
   * replace those keys. So the adapter omits from the metadata every key that
   * the non-plain object input already has as an own enumerable key.
   */
  private write(method: LogMethod, params: readonly unknown[]): void {
    const [input, ...extraInput] = params;
    const durableData = this.getDurableData();

    if (isPlainObject(input)) {
      this.powertoolsLogger[method](
        { ...durableData, ...input },
        ...extraInput,
      );
      return;
    }

    this.powertoolsLogger[method](
      input,
      omitKeysOf(durableData, input),
      ...extraInput,
    );
  }

  /**
   * Returns the durable metadata without keys whose value is `undefined`.
   * The root context has no `operationId`, for example. So its log entries
   * carry no `operationId` key.
   */
  private getDurableData(): Partial<DurableLogData> {
    const data = this.durableLoggingContext?.getDurableLogData() ?? {};
    return Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    );
  }
}

/**
 * Wraps a Powertools for AWS Lambda (TypeScript) `Logger` so that every log
 * entry contains the durable execution metadata: `executionArn`, `requestId`,
 * `tenantId`, `operationId`, `operationName`, and `attempt`. Keys without a
 * value are omitted.
 *
 * The keys use the same names as the SDK's default logger and the Python SDK.
 * A key that the caller passes replaces the metadata key with the same name.
 *
 * Powertools writes through the global `console` when the `POWERTOOLS_DEV`
 * environment variable is set. Lambda's JSON log format then wraps each
 * Powertools entry in a second JSON object. So leave `POWERTOOLS_DEV` unset in
 * deployed functions.
 *
 * @example
 * ```ts
 * import { Logger } from "@aws-lambda-powertools/logger";
 * import {
 *   createPowertoolsLogger,
 *   withDurableExecution,
 * } from "@aws/durable-execution-sdk-js";
 *
 * const logger = new Logger({ serviceName: "my-service" });
 *
 * export const handler = withDurableExecution(async (event, context) => {
 *   context.configureLogger({ customLogger: createPowertoolsLogger(logger) });
 *   context.logger.info("workflow-started");
 * });
 * ```
 *
 * @param powertoolsLogger - The Powertools `Logger` that writes the log entries
 * @returns A logger to pass as `customLogger` to `context.configureLogger`
 * @public
 */
export function createPowertoolsLogger<Logger extends PowertoolsLoggerLike>(
  powertoolsLogger: Logger,
): PowertoolsDurableLogger<Logger> {
  return new PowertoolsDurableLogger(powertoolsLogger);
}
