import type { Context } from "aws-lambda";
import {
  DurableExecutionInvocationInputWithClient,
  withDurableExecution,
  type DurableInstrumentationPlugin,
  type InvocationInfo,
} from "./index";

function invocation() {
  return new DurableExecutionInvocationInputWithClient(
    {
      DurableExecutionArn: "arn:execution:carrier-failure",
      CheckpointToken: "token",
      InitialExecutionState: {
        Operations: [
          {
            Id: "execution",
            Type: "EXECUTION",
            Status: "STARTED",
            StartTimestamp: new Date("2026-01-01T00:00:00Z"),
            ExecutionDetails: { InputPayload: '{"value":"unchanged"}' },
          },
        ],
      },
    },
    {
      async checkpoint() {
        throw new Error("unexpected checkpoint");
      },
      async getExecutionState() {
        throw new Error("unexpected state request");
      },
    },
  );
}

function lambdaContext(): Context {
  return {
    awsRequestId: "request",
    getRemainingTimeInMillis: () => 30_000,
    callbackWaitsForEmptyEventLoop: false,
    functionName: "handler",
    functionVersion: "1",
    invokedFunctionArn: "handler:1",
    memoryLimitInMB: "128",
    logGroupName: "group",
    logStreamName: "stream",
    done() {},
    fail() {},
    succeed() {},
  };
}

const registrations = [
  "none",
  "empty-list",
  "start-hook",
  "wrap-only",
] as const;

describe("optional runtime trace carrier through the real public wrapper", () => {
  let previousPlugins: string | undefined;
  beforeEach(() => {
    previousPlugins = process.env.DURABLE_EXECUTION_PLUGINS;
    delete process.env.DURABLE_EXECUTION_PLUGINS;
  });
  afterEach(() => {
    if (previousPlugins === undefined)
      delete process.env.DURABLE_EXECUTION_PLUGINS;
    else process.env.DURABLE_EXECUTION_PLUGINS = previousPlugins;
  });

  it.each(
    registrations.flatMap((registration) =>
      ["getter", "has-proxy"].map((failure) => ({ registration, failure })),
    ),
  )(
    "isolates a throwing $failure with $registration registration",
    async ({ registration, failure }) => {
      let reads = 0;
      let hasChecks = 0;
      let runtime = lambdaContext();
      if (failure === "getter") {
        Object.defineProperty(runtime, "xRayTraceId", {
          get() {
            reads++;
            throw new Error("optional carrier unavailable");
          },
        });
      } else {
        runtime = new Proxy(runtime, {
          get(target, key, receiver) {
            if (key === "xRayTraceId") reads++;
            return Reflect.get(target, key, receiver);
          },
          has(target, key) {
            if (key === "xRayTraceId") {
              hasChecks++;
              throw new Error("optional carrier lookup unavailable");
            }
            return Reflect.has(target, key);
          },
        });
      }
      const infos: InvocationInfo[] = [];
      const plugins: DurableInstrumentationPlugin[] =
        registration === "start-hook"
          ? [
              {
                async onInvocationStart(info) {
                  infos.push(info);
                },
              },
            ]
          : registration === "wrap-only"
            ? [
                {
                  async wrapInvocation(info, fn) {
                    infos.push(info);
                    return fn();
                  },
                },
              ]
            : [];
      const body = jest.fn(async (event: { value: string }) => event.value);
      const handler =
        registration === "none"
          ? withDurableExecution(body)
          : withDurableExecution(body, { plugins });
      await expect(handler(invocation(), runtime)).resolves.toEqual({
        Status: "SUCCEEDED",
        Result: '"unchanged"',
      });
      expect(body).toHaveBeenCalledTimes(1);
      const registered = plugins.length > 0;
      expect(reads).toBe(registered ? 1 : 0);
      expect(hasChecks).toBe(registered && failure === "has-proxy" ? 1 : 0);
      if (registered) {
        expect(infos).toHaveLength(1);
        expect(infos[0]).toHaveProperty("xRayTraceId", "");
      }
    },
  );
});
