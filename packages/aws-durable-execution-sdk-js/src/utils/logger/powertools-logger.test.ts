import { DurableLoggingContext } from "../../types/durable-logger";
import { DurableLogData } from "../../types/logger";
import {
  createPowertoolsLogger,
  PowertoolsDurableLogger,
  PowertoolsLoggerLike,
} from "./powertools-logger";

const METHODS = ["info", "warn", "error", "debug"] as const;

function createStubLogger(): jest.Mocked<PowertoolsLoggerLike> {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

function contextReturning(
  getData: () => DurableLogData,
  getLogEnrichment?: DurableLoggingContext["getLogEnrichment"],
): DurableLoggingContext {
  return { getDurableLogData: getData, getLogEnrichment };
}

const STEP_DATA: DurableLogData = {
  executionArn: "arn:aws:lambda:us-east-1:123456789012:function:fn",
  requestId: "request-1",
  tenantId: undefined,
  operationId: "op-1",
  operationName: "charge",
  attempt: 2,
};

const STEP_DATA_WITHOUT_UNDEFINED = {
  executionArn: STEP_DATA.executionArn,
  requestId: STEP_DATA.requestId,
  operationId: STEP_DATA.operationId,
  operationName: STEP_DATA.operationName,
  attempt: STEP_DATA.attempt,
};

describe("createPowertoolsLogger", () => {
  it("returns a PowertoolsDurableLogger that wraps the given logger", () => {
    const stub = createStubLogger();

    const logger = createPowertoolsLogger(stub);

    expect(logger).toBeInstanceOf(PowertoolsDurableLogger);
    expect(logger.powertoolsLogger).toBe(stub);
  });

  describe.each(METHODS)("%s", (method) => {
    it("passes the durable metadata as the first extra argument for a string message", () => {
      const stub = createStubLogger();
      const logger = createPowertoolsLogger(stub);
      logger.configureDurableLoggingContext(contextReturning(() => STEP_DATA));

      logger[method]("hello", { userId: "u-1" });

      expect(stub[method]).toHaveBeenCalledTimes(1);
      expect(stub[method]).toHaveBeenCalledWith(
        "hello",
        STEP_DATA_WITHOUT_UNDEFINED,
        { userId: "u-1" },
      );
    });

    it("merges the durable metadata before the keys of a plain-object message", () => {
      const stub = createStubLogger();
      const logger = createPowertoolsLogger(stub);
      logger.configureDurableLoggingContext(contextReturning(() => STEP_DATA));

      logger[method]({ message: "hello", userId: "u-1" }, { extra: 1 });

      expect(stub[method]).toHaveBeenCalledWith(
        { ...STEP_DATA_WITHOUT_UNDEFINED, message: "hello", userId: "u-1" },
        { extra: 1 },
      );
    });

    it("lets a key in a plain-object message replace the metadata key", () => {
      const stub = createStubLogger();
      const logger = createPowertoolsLogger(stub);
      logger.configureDurableLoggingContext(contextReturning(() => STEP_DATA));

      logger[method]({ message: "hello", operationName: "caller-value" });

      const [input] = stub[method].mock.calls[0];
      expect(input).toEqual(
        expect.objectContaining({ operationName: "caller-value" }),
      );
    });
  });

  it("does not spread an Error message, because its message and stack are not enumerable", () => {
    const stub = createStubLogger();
    const logger = createPowertoolsLogger(stub);
    logger.configureDurableLoggingContext(contextReturning(() => STEP_DATA));
    const error = new Error("boom");

    logger.error(error);

    expect(stub.error).toHaveBeenCalledWith(error, STEP_DATA_WITHOUT_UNDEFINED);
  });

  it("does not spread a class instance message", () => {
    class Payload {
      constructor(readonly value: number) {}
    }
    const stub = createStubLogger();
    const logger = createPowertoolsLogger(stub);
    logger.configureDurableLoggingContext(contextReturning(() => STEP_DATA));
    const payload = new Payload(1);

    logger.info(payload);

    expect(stub.info).toHaveBeenCalledWith(
      payload,
      STEP_DATA_WITHOUT_UNDEFINED,
    );
  });

  it("omits a metadata key that a class instance message already has, so the caller's value is kept", () => {
    class Payload {
      constructor(
        readonly message: string,
        readonly operationName: string,
      ) {}
    }
    const stub = createStubLogger();
    const logger = createPowertoolsLogger(stub);
    logger.configureDurableLoggingContext(contextReturning(() => STEP_DATA));
    const payload = new Payload("hello", "caller-value");

    logger.info(payload);

    const { operationName: _omitted, ...expected } =
      STEP_DATA_WITHOUT_UNDEFINED;
    expect(stub.info).toHaveBeenCalledWith(payload, expected);
  });

  it("omits a metadata key that an Error message has as an own enumerable key", () => {
    const stub = createStubLogger();
    const logger = createPowertoolsLogger(stub);
    logger.configureDurableLoggingContext(contextReturning(() => STEP_DATA));
    const error = Object.assign(new Error("boom"), { attempt: 9 });

    logger.error(error);

    const { attempt: _omitted, ...expected } = STEP_DATA_WITHOUT_UNDEFINED;
    expect(stub.error).toHaveBeenCalledWith(error, expected);
  });

  it("merges into an object with a null prototype", () => {
    const stub = createStubLogger();
    const logger = createPowertoolsLogger(stub);
    logger.configureDurableLoggingContext(contextReturning(() => STEP_DATA));
    const input = Object.assign(Object.create(null), { message: "hello" });

    logger.info(input);

    expect(stub.info).toHaveBeenCalledWith({
      ...STEP_DATA_WITHOUT_UNDEFINED,
      message: "hello",
    });
  });

  it("reads the metadata on every call, so each call logs the current operation", () => {
    const stub = createStubLogger();
    const logger = createPowertoolsLogger(stub);
    let current: DurableLogData = { ...STEP_DATA, operationId: "op-1" };
    logger.configureDurableLoggingContext(contextReturning(() => current));

    logger.info("first");
    current = { ...STEP_DATA, operationId: "op-2", attempt: 1 };
    logger.info("second");

    expect(stub.info.mock.calls[0][1]).toEqual(
      expect.objectContaining({ operationId: "op-1", attempt: 2 }),
    );
    expect(stub.info.mock.calls[1][1]).toEqual(
      expect.objectContaining({ operationId: "op-2", attempt: 1 }),
    );
  });

  it("omits keys whose value is undefined", () => {
    const stub = createStubLogger();
    const logger = createPowertoolsLogger(stub);
    logger.configureDurableLoggingContext(
      contextReturning(() => ({
        executionArn: "arn",
        requestId: "request-1",
        operationId: undefined,
      })),
    );

    logger.info("root");

    // toHaveBeenCalledWith treats a key whose value is undefined as missing.
    // So the test checks the key list.
    const [, metadata] = stub.info.mock.calls[0];
    expect(Object.keys(metadata as object).sort()).toEqual([
      "executionArn",
      "requestId",
    ]);
  });

  it("passes an empty metadata object before the SDK configures the logging context", () => {
    const stub = createStubLogger();
    const logger = createPowertoolsLogger(stub);

    logger.info("early");

    expect(stub.info).toHaveBeenCalledWith("early", {});
  });

  it("uses the most recently configured logging context", () => {
    const stub = createStubLogger();
    const logger = createPowertoolsLogger(stub);
    // The SDK configures the logger once for each durable context of one
    // execution: the root context and every child context. All of them have
    // the same executionArn.
    logger.configureDurableLoggingContext(
      contextReturning(() => ({
        executionArn: "arn",
        requestId: "r",
        operationName: "root-context",
      })),
    );
    logger.configureDurableLoggingContext(
      contextReturning(() => ({
        executionArn: "arn",
        requestId: "r",
        operationName: "child-context",
      })),
    );

    logger.info("hello");

    expect(stub.info).toHaveBeenCalledWith("hello", {
      executionArn: "arn",
      requestId: "r",
      operationName: "child-context",
    });
  });

  describe("plugin log fields", () => {
    it("adds the plugin fields after the durable metadata", () => {
      const stub = createStubLogger();
      const logger = createPowertoolsLogger(stub);
      logger.configureDurableLoggingContext(
        contextReturning(
          () => STEP_DATA,
          () => ({ traceId: "trace-1", spanId: "span-1" }),
        ),
      );

      logger.info("hello");

      expect(stub.info).toHaveBeenCalledWith("hello", {
        ...STEP_DATA_WITHOUT_UNDEFINED,
        traceId: "trace-1",
        spanId: "span-1",
      });
    });

    it("lets a plugin field replace a metadata field, as the default logger does", () => {
      const stub = createStubLogger();
      const logger = createPowertoolsLogger(stub);
      logger.configureDurableLoggingContext(
        contextReturning(
          () => STEP_DATA,
          () => ({ operationName: "from-plugin" }),
        ),
      );

      logger.info("hello");

      expect(stub.info.mock.calls[0][1]).toEqual(
        expect.objectContaining({ operationName: "from-plugin" }),
      );
    });

    it("lets a caller key replace a plugin field", () => {
      const stub = createStubLogger();
      const logger = createPowertoolsLogger(stub);
      logger.configureDurableLoggingContext(
        contextReturning(
          () => STEP_DATA,
          () => ({ traceId: "trace-1" }),
        ),
      );

      logger.info({ message: "hello", traceId: "caller" });

      expect(stub.info.mock.calls[0][0]).toEqual(
        expect.objectContaining({ traceId: "caller" }),
      );
    });

    it("reads the plugin fields on every call", () => {
      const stub = createStubLogger();
      const logger = createPowertoolsLogger(stub);
      let spanId = "span-1";
      logger.configureDurableLoggingContext(
        contextReturning(
          () => STEP_DATA,
          () => ({ spanId }),
        ),
      );

      logger.info("first");
      spanId = "span-2";
      logger.info("second");

      expect(stub.info.mock.calls[0][1]).toEqual(
        expect.objectContaining({ spanId: "span-1" }),
      );
      expect(stub.info.mock.calls[1][1]).toEqual(
        expect.objectContaining({ spanId: "span-2" }),
      );
    });

    it("adds only the durable metadata when no plugin adds fields", () => {
      const stub = createStubLogger();
      const logger = createPowertoolsLogger(stub);
      logger.configureDurableLoggingContext(
        contextReturning(
          () => STEP_DATA,
          () => undefined,
        ),
      );

      logger.info("hello");

      expect(stub.info).toHaveBeenCalledWith(
        "hello",
        STEP_DATA_WITHOUT_UNDEFINED,
      );
    });

    it("works with a logging context that has no getLogEnrichment method", () => {
      const stub = createStubLogger();
      const logger = createPowertoolsLogger(stub);
      logger.configureDurableLoggingContext({
        getDurableLogData: () => STEP_DATA,
      });

      logger.info("hello");

      expect(stub.info).toHaveBeenCalledWith(
        "hello",
        STEP_DATA_WITHOUT_UNDEFINED,
      );
    });
  });

  it("calls the Powertools method with the logger as `this`", () => {
    const calls: unknown[] = [];
    const stub = {
      info(this: unknown, _input: unknown) {
        calls.push(this);
      },
      warn() {},
      error() {},
      debug() {},
    };
    const logger = createPowertoolsLogger(stub);

    logger.info("hello");

    expect(calls).toEqual([stub]);
  });
});
