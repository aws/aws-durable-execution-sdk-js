import { AsyncLocalStorage } from "node:async_hooks";
import {
  withDurableExecution,
  type DurableContext,
  type InvocationInfo,
} from "@aws/durable-execution-sdk-js";
import {
  deriveExecutionTraceId,
  xRayContextExtractor,
  type ContextExtractorResult,
} from "@aws/durable-execution-sdk-js-otel";
import type { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "OTel Runtime Carrier",
  description:
    "Verify the invocation-local X-Ray carrier through a durable wait and resume",
  capacityProviderConfig: {},
  lambdaTimeoutSeconds: 10,
  durableConfig: { ExecutionTimeout: 120, RetentionPeriodInDays: 7 },
};

const invocation = new AsyncLocalStorage<InvocationInfo>();

export interface CarrierObservation {
  requestId: string;
  functionName: string;
  runtimeHeader: string | null;
  forwardedHeader: string | null;
  extracted: NonNullable<ContextExtractorResult> | null;
  traceId: string;
}

function captureCarrier(context: DurableContext): CarrierObservation {
  const info = invocation.getStore();
  if (!info) throw new Error("Invocation metadata scope is missing");
  const runtimeHeader = (
    context.lambdaContext as typeof context.lambdaContext & {
      xRayTraceId?: string;
    }
  ).xRayTraceId;
  return {
    requestId: context.lambdaContext.awsRequestId,
    functionName: context.lambdaContext.functionName,
    runtimeHeader: runtimeHeader ?? null,
    forwardedHeader: info.xRayTraceId ?? null,
    extracted: xRayContextExtractor(info) ?? null,
    traceId: deriveExecutionTraceId(
      process.env,
      info.executionArn,
      info.executionStartTimestamp,
      { xRayTraceId: runtimeHeader },
    ),
  };
}

export const handler = withDurableExecution(
  async (_, context) => {
    // Runtime metadata can differ on resume, so read it only inside these steps.
    const first = await context.step("capture-initial-carrier", async () =>
      captureCarrier(context),
    );
    await context.wait("resume-with-runtime-carrier", { seconds: 30 });
    const resumed = await context.step("capture-resumed-carrier", async () =>
      captureCarrier(context),
    );
    return { first, resumed };
  },
  {
    plugins: [
      {
        createPlugin: () => ({
          wrapInvocation(info, fn) {
            return invocation.run(info, fn);
          },
        }),
      },
    ],
  },
);
