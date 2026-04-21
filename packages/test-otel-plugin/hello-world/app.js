"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const durable_execution_sdk_js_1 = require("@aws/durable-execution-sdk-js");
const durable_execution_sdk_js_otel_1 = require("@aws/durable-execution-sdk-js-otel");
const sdk_trace_node_1 = require("@opentelemetry/sdk-trace-node");
const sdk_trace_base_1 = require("@opentelemetry/sdk-trace-base");
const exporter_trace_otlp_http_1 = require("@opentelemetry/exporter-trace-otlp-http");
const id_generator_aws_xray_1 = require("@opentelemetry/id-generator-aws-xray");
const propagator_aws_xray_1 = require("@opentelemetry/propagator-aws-xray");
const exporter = new exporter_trace_otlp_http_1.OTLPTraceExporter({
  url: "http://localhost:4318/v1/traces",
});
const provider = new sdk_trace_node_1.NodeTracerProvider({
  idGenerator: new id_generator_aws_xray_1.AWSXRayIdGenerator(),
  spanProcessors: [new sdk_trace_base_1.SimpleSpanProcessor(exporter)],
});
provider.register({
  propagator: new propagator_aws_xray_1.AWSXRayPropagator(),
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
const lambdaHandler = (0, durable_execution_sdk_js_1.withDurableExecution)(
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
    // Step 3: ctx.map - Map with 5 iterations returning numbers 1 to 5
    const mapInput = [1, 2, 3, 4, 5];
    const mapResults = await context.map(
      "map-numbers",
      mapInput,
      async (ctx, item, index) => {
        // Each iteration returns the number (1 to 5)
        const result = await ctx.step(`map-step-${index}`, async () => {
          return item;
        });
        return result;
      },
    );
    // Step 4: ctx.parallel - 3 branches, each returning a fruit name
    const parallelResults = await context.parallel([
      // Branch 1: Returns "apple"
      async (ctx) => {
        const result = await ctx.step("fruit-step-1", async () => {
          return "apple";
        });
        return result;
      },
      // Branch 2: Returns "banana"
      async (ctx) => {
        const result = await ctx.step("fruit-step-2", async () => {
          return "banana";
        });
        return result;
      },
      // Branch 3: Returns "orange"
      async (ctx) => {
        const result = await ctx.step("fruit-step-3", async () => {
          return "orange";
        });
        return result;
      },
    ]);
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
    // Final result combining all operations
    return {
      step1: step1Result,
      waitCompleted: true,
      mapResults,
      parallelResults,
      invokeResult,
      stepRetryResult,
      waitForConditionStep,
    };
  },
  {
    plugins: [
      new durable_execution_sdk_js_otel_1.DurableOtelPlugin({
        provider,
        contextExtractor: durable_execution_sdk_js_otel_1.xRayContextExtractor,
        samplingRate: 1,
      }),
    ],
  },
);
module.exports = { lambdaHandler };
