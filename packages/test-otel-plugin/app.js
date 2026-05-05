"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const durable_execution_sdk_js_1 = require("@aws/durable-execution-sdk-js");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const durable_execution_sdk_js_otel_1 = require("@aws/durable-execution-sdk-js-otel");
const sdk_trace_node_1 = require("@opentelemetry/sdk-trace-node");
const sdk_trace_base_1 = require("@opentelemetry/sdk-trace-base");
const exporter_trace_otlp_http_1 = require("@opentelemetry/exporter-trace-otlp-http");
const propagator_aws_xray_1 = require("@opentelemetry/propagator-aws-xray");
const api_1 = require("@opentelemetry/api");
const instrumentation_aws_sdk_1 = require("@opentelemetry/instrumentation-aws-sdk");
const instrumentation_1 = require("@opentelemetry/instrumentation");
const sqsClient = new client_sqs_1.SQSClient({});
const exporter = new exporter_trace_otlp_http_1.OTLPTraceExporter({
  url: "http://localhost:4318/v1/traces",
});
const idGenerator =
  new durable_execution_sdk_js_otel_1.DeterministicIdGenerator();
const provider = new sdk_trace_node_1.NodeTracerProvider({
  idGenerator,
  spanProcessors: [
    new sdk_trace_base_1.SimpleSpanProcessor(exporter),
    new sdk_trace_base_1.SimpleSpanProcessor(
      new sdk_trace_base_1.ConsoleSpanExporter(),
    ),
  ],
  sampler: new sdk_trace_base_1.AlwaysOnSampler(),
});
provider.register({
  propagator: new propagator_aws_xray_1.AWSXRayPropagator(),
});
(0, instrumentation_1.registerInstrumentations)({
  tracerProvider: provider,
  instrumentations: [
    new instrumentation_aws_sdk_1.AwsInstrumentation({
      suppressInternalInstrumentation: true, // avoids noisy HTTP sub-spans
      sqsExtractContextPropagationFromPayload: true, // for receiving side
    }),
  ],
});
class MyError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError"; // Custom name for debugging
  }
}
/**
 * Durable Lambda function handler.
 */
const durableHandler = (0, durable_execution_sdk_js_1.withDurableExecution)(
  async (event, context) => {
    context.logger.info(
      "Starting comprehensive operations example with event:",
      event,
    );
    // Step 1: ctx.step - Simple step that returns a result
    const step1Result = await context.step("step1", async () => {
      context.logger.info("Executing step1");
      return "Step 1 completed successfully";
    });
    // Step 2: ctx.wait - Wait for 1 second
    await context.wait({ seconds: 1 });
    // // Step 3: ctx.map - Map with 3 iterations returning numbers 1 to 3
    // const mapInput = [1, 2, 3];
    // const mapResults = await context.map(
    //   "map-numbers",
    //   mapInput,
    //   async (ctx, item, index) => {
    //     // Each iteration returns the number (1 to 5)
    //     const result = await ctx.step(`map-step-${index}`, async () => {
    //       return item;
    //     });
    //     return result;
    //   },
    // );
    // // Step 4: ctx.parallel - 2 branches, each returning a fruit name
    // const parallelResults = await context.parallel([
    //   // Branch 1: Returns "apple"
    //   async (ctx: DurableContext) => {
    //     const result = await ctx.step("fruit-step-1", async () => {
    //       return "apple";
    //     });
    //     return result;
    //   },
    //   // Branch 2: Returns "banana"
    //   async (ctx: DurableContext) => {
    //     const result = await ctx.step("fruit-step-2", async () => {
    //       return "banana";
    //     });
    //     return result;
    //   },
    // ]);
    const invokeResult = await context.invoke("hello-world", {
      key1: "value1",
      key2: "value2",
      key3: "value3",
    });
    const stepRetryResult = await context.step(
      "test step retry",
      async () => {
        if (Math.random() * 100 > 80) {
          return "test retry step completed successfully";
        } else {
          throw new MyError("my error");
        }
      },
      {
        retryStrategy: (error, attemptCount) => {
          var shouldRetry = true;
          if (attemptCount > 10) {
            shouldRetry = false;
          }
          return {
            shouldRetry,
            delay: { seconds: 5 },
          };
        },
      },
    );
    const waitForConditionStep = await context.waitForCondition(
      "test wait for condition",
      async () => {
        if (Math.random() * 100 > 80) {
          return { ready: true };
        } else {
          return { ready: false };
        }
      },
      {
        initialState: { ready: false },
        waitStrategy(state, attempt) {
          var shouldContinue = true;
          if (state.ready) {
            shouldContinue = false;
          } else {
            shouldContinue = true;
          }
          if (attempt > 10) {
            shouldContinue = false;
          }
          return {
            shouldContinue,
            delay: { seconds: 5 },
          };
        },
      },
    );
    // Step: Send message to SQS
    const sqsMessageId = await context.step("send-sqs-message", async () => {
      const command = new client_sqs_1.SendMessageCommand({
        QueueUrl: process.env.QUEUE_URL,
        MessageBody: JSON.stringify({
          source: "durable-function",
          timestamp: Date.now(),
          data: { step1Result, invokeResult },
        }),
      });
      const response = await sqsClient.send(command);
      return response.MessageId;
    });
    const parallelWaitsResults = await context.parallel([
      // Branch 1: Returns "basketball"
      async (ctx) => {
        await ctx.wait("wait-sport-step-1", { seconds: 5 });
        const result = await ctx.step("sport-step-1", async () => {
          return "basketball";
        });
        await ctx.wait("wait-sport-step-1-2", { seconds: 5 });
        return result;
      },
      // Branch 2: Returns "football"
      async (ctx) => {
        await ctx.wait("wait-sport-step-2", { seconds: 10 });
        const result = await ctx.step("sport-step-2", async () => {
          return "football";
        });
        const result2 = await ctx.step("sport-step-2-1", async () => {
          return "soccer";
        });
        return result;
      },
    ]);
    const mapWaitInput = [1, 2, 3];
    const mapWaitResults = await context.map(
      "map-numbers-wait",
      mapWaitInput,
      async (ctx, item, index) => {
        // Each iteration returns the number (1 to 3)
        await ctx.wait(`map-wait-step-${index}`, { seconds: 5 * item });
        const result = await ctx.step(
          `map-numbers-wait-step-${index}`,
          async () => {
            return item;
          },
        );
        await ctx.wait(`map-wait-step-${index}-2`, { seconds: 5 });
        return result;
      },
    );
    // Final result combining all operations
    return {
      step1: step1Result,
      waitCompleted: true,
      invokeResult,
      stepRetryResult,
      waitForConditionStep,
      sqsMessageId,
      parallelWaitsResults,
      mapWaitResults,
    };
  },
  {
    plugins: [
      new durable_execution_sdk_js_otel_1.DurableOtelPlugin({
        provider,
        idGenerator,
        contextExtractor: durable_execution_sdk_js_otel_1.xRayContextExtractor,
        samplingRate: 1,
      }),
    ],
  },
);
const lambdaHandler = async (event, lambdaContext) => {
  // CRITICAL: Extract X-Ray trace context per invocation
  const xrayTraceId = process.env._X_AMZN_TRACE_ID;
  const parentContext = xrayTraceId
    ? api_1.propagation.extract(api_1.ROOT_CONTEXT, {
        "x-amzn-trace-id": xrayTraceId,
      })
    : api_1.ROOT_CONTEXT;
  return api_1.context.with(parentContext, async () => {
    try {
      return await durableHandler(event, lambdaContext);
    } finally {
      await provider.forceFlush();
    }
  });
};
module.exports = { lambdaHandler };
